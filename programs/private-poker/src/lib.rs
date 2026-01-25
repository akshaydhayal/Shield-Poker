use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::{
    CommitAndUndelegatePermissionCpiBuilder, CreatePermissionCpiBuilder, UpdatePermissionCpiBuilder,
};
use ephemeral_rollups_sdk::access_control::structs::{Member, MembersArgs};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::consts::PERMISSION_PROGRAM_ID;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

declare_id!("7t2s5A3AvsGZq8rzngZujis6khcPesjm5FYV21ARosNN");

// MagicBlock Program IDs (PERMISSION_PROGRAM_ID is imported from SDK)
use anchor_lang::solana_program::pubkey;
const DELEGATION_PROGRAM_ID: Pubkey = pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

// Seeds
const GAME_SEED: &[u8] = b"game";
const PLAYER_STATE_SEED: &[u8] = b"player_state";
const GAME_VAULT_SEED: &[u8] = b"game_vault";

#[program]
#[ephemeral]
pub mod private_poker {
    use super::*;

    /// Initialize a new poker game
    pub fn initialize_game(ctx: Context<InitializeGame>, game_id: u64, buy_in: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player1 = ctx.accounts.player1.key();

        game.game_id = game_id;
        game.player1 = Some(player1);
        game.player2 = None;
        game.buy_in = buy_in;
        game.pot_amount = 0;
        game.current_turn = None;
        game.phase = GamePhase::Waiting;
        game.board_cards = [0u8; 5];
        game.small_blind = buy_in / 20; // 5% of buy-in
        game.big_blind = buy_in / 10; // 10% of buy-in
        game.deck_seed = [0u8; 32];
        game.last_action_ts = Clock::get()?.unix_timestamp;

        // Transfer buy-in to vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.player1.to_account_info(),
                to: ctx.accounts.game_vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, buy_in)?;

        // Initialize player1 state
        let player_state = &mut ctx.accounts.player1_state;
        player_state.game_id = game_id;
        player_state.player = player1;
        player_state.chips_committed = buy_in;
        player_state.has_folded = false;
        player_state.hand = [0u8; 2];

        msg!("Game {} initialized by player {}", game_id, player1);

        Ok(())
    }

    /// Second player joins the game
    pub fn join_game(ctx: Context<JoinGame>, game_id: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player2 = ctx.accounts.player2.key();

        require!(game.player1 != Some(player2), PokerError::CannotJoinOwnGame);
        require!(game.player2.is_none(), PokerError::GameFull);
        require!(game.phase == GamePhase::Waiting, PokerError::InvalidGamePhase);

        game.player2 = Some(player2);
        game.phase = GamePhase::PreFlop;
        game.current_turn = game.player1; // Small blind acts first

        // Transfer buy-in to vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.player2.to_account_info(),
                to: ctx.accounts.game_vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, game.buy_in)?;

        // Initialize player2 state
        let player_state = &mut ctx.accounts.player2_state;
        player_state.game_id = game_id;
        player_state.player = player2;
        player_state.chips_committed = game.buy_in;
        player_state.has_folded = false;
        player_state.hand = [0u8; 2];

        // Post blinds
        game.pot_amount = game.small_blind + game.big_blind;

        msg!("Player {} joined game {}", player2, game_id);

        Ok(())
    }

    /// Set deck seed (from VRF or commit-reveal)
    pub fn set_deck_seed(ctx: Context<SetDeckSeed>, seed: [u8; 32]) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.phase == GamePhase::PreFlop,
            PokerError::InvalidGamePhase
        );
        game.deck_seed = seed;
        msg!("Deck seed set for game {}", game.game_id);
        Ok(())
    }

    /// Deal cards to players (cards are encrypted via PER)
    pub fn deal_cards(
        ctx: Context<DealCards>,
        player1_hand: [u8; 2],
        player2_hand: [u8; 2],
    ) -> Result<()> {
        let game = &ctx.accounts.game;
        require!(
            game.phase == GamePhase::PreFlop,
            PokerError::InvalidGamePhase
        );

        let player1_state = &mut ctx.accounts.player1_state;
        let player2_state = &mut ctx.accounts.player2_state;

        player1_state.hand = player1_hand;
        player2_state.hand = player2_hand;

        msg!("Cards dealt for game {}", game.game_id);

        Ok(())
    }

    /// Player action: Bet, Call, Fold, or Check
    pub fn player_action(
        ctx: Context<PlayerAction>,
        action: PlayerActionType,
        amount: Option<u64>,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player = ctx.accounts.player.key();

        require!(
            game.current_turn == Some(player),
            PokerError::NotYourTurn
        );
        require!(
            game.phase != GamePhase::Finished && game.phase != GamePhase::Waiting,
            PokerError::InvalidGamePhase
        );

        let player_state = if player == game.player1.unwrap() {
            &mut ctx.accounts.player1_state
        } else {
            &mut ctx.accounts.player2_state
        };

        require!(!player_state.has_folded, PokerError::PlayerFolded);

        match action {
            PlayerActionType::Fold => {
                player_state.has_folded = true;
                msg!("Player {} folded", player);
            }
            PlayerActionType::Check => {
                require!(
                    game.pot_amount % 2 == 0 || game.current_turn == game.player2,
                    PokerError::CannotCheck
                );
                msg!("Player {} checked", player);
            }
            PlayerActionType::Call => {
                let call_amount = game.pot_amount.saturating_sub(player_state.chips_committed);
                require!(call_amount > 0, PokerError::InvalidAction);
                player_state.chips_committed += call_amount;
                game.pot_amount += call_amount;

                // Transfer SOL to vault
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.player.to_account_info(),
                        to: ctx.accounts.game_vault.to_account_info(),
                    },
                );
                anchor_lang::system_program::transfer(cpi_context, call_amount)?;

                msg!("Player {} called {}", player, call_amount);
            }
            PlayerActionType::Bet => {
                let bet_amount = amount.ok_or(PokerError::InvalidAction)?;
                require!(bet_amount >= game.big_blind, PokerError::BetTooSmall);
                player_state.chips_committed += bet_amount;
                game.pot_amount += bet_amount;

                // Transfer SOL to vault
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.player.to_account_info(),
                        to: ctx.accounts.game_vault.to_account_info(),
                    },
                );
                anchor_lang::system_program::transfer(cpi_context, bet_amount)?;

                msg!("Player {} bet {}", player, bet_amount);
            }
        }

        // Switch turn
        game.current_turn = if game.current_turn == game.player1 {
            game.player2
        } else {
            game.player1
        };

        game.last_action_ts = Clock::get()?.unix_timestamp;

        Ok(())
    }

    /// Advance game phase (PreFlop -> Flop -> Turn -> River -> Showdown)
    pub fn advance_phase(ctx: Context<AdvancePhase>) -> Result<()> {
        let game = &mut ctx.accounts.game;

        match game.phase {
            GamePhase::PreFlop => {
                // Both players must have acted
                require!(
                    ctx.accounts.player1_state.chips_committed
                        == ctx.accounts.player2_state.chips_committed,
                    PokerError::ActionPending
                );
                game.phase = GamePhase::Flop;
                game.current_turn = game.player1;
                // Reveal first 3 board cards (in real implementation, use VRF)
                game.board_cards[0] = 1;
                game.board_cards[1] = 1;
                game.board_cards[2] = 1;
            }
            GamePhase::Flop => {
                require!(
                    ctx.accounts.player1_state.chips_committed
                        == ctx.accounts.player2_state.chips_committed,
                    PokerError::ActionPending
                );
                game.phase = GamePhase::Turn;
                game.current_turn = game.player1;
                game.board_cards[3] = 1; // Reveal turn card
            }
            GamePhase::Turn => {
                require!(
                    ctx.accounts.player1_state.chips_committed
                        == ctx.accounts.player2_state.chips_committed,
                    PokerError::ActionPending
                );
                game.phase = GamePhase::River;
                game.current_turn = game.player1;
                game.board_cards[4] = 1; // Reveal river card
            }
            GamePhase::River => {
                require!(
                    ctx.accounts.player1_state.chips_committed
                        == ctx.accounts.player2_state.chips_committed,
                    PokerError::ActionPending
                );
                game.phase = GamePhase::Showdown;
                game.current_turn = None;
            }
            _ => return Err(PokerError::InvalidGamePhase.into()),
        }

        msg!("Game {} advanced to phase {:?}", game.game_id, game.phase);

        Ok(())
    }

    /// Resolve game and determine winner
    pub fn resolve_game(ctx: Context<ResolveGame>, winner: Pubkey) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player1_state = &ctx.accounts.player1_state;
        let player2_state = &ctx.accounts.player2_state;

        require!(
            game.phase == GamePhase::Showdown || game.phase == GamePhase::Finished,
            PokerError::InvalidGamePhase
        );

        // Determine winner (if both folded, last standing wins)
        let actual_winner = if player1_state.has_folded {
            game.player2.ok_or(PokerError::MissingOpponent)?
        } else if player2_state.has_folded {
            game.player1.ok_or(PokerError::MissingOpponent)?
        } else {
            let p1 = game.player1.ok_or(PokerError::MissingOpponent)?;
            let p2 = game.player2.ok_or(PokerError::MissingOpponent)?;
            require!(winner == p1 || winner == p2, PokerError::InvalidWinner);
            winner
        };

        // Transfer winnings to winner
        let vault_balance = ctx.accounts.game_vault.get_lamports();
        **ctx.accounts.game_vault.try_borrow_mut_lamports()? -= vault_balance;
        **ctx.accounts.winner.try_borrow_mut_lamports()? += vault_balance;

        game.phase = GamePhase::Finished;
        game.winner = Some(actual_winner);

        msg!("Game {} resolved. Winner: {}", game.game_id, actual_winner);

        // Update permissions to make accounts public before payout
        let permission_program = &ctx.accounts.permission_program.to_account_info();
        let permission_game = &ctx.accounts.permission_game.to_account_info();
        let permission1 = &ctx.accounts.permission1.to_account_info();
        let permission2 = &ctx.accounts.permission2.to_account_info();

        UpdatePermissionCpiBuilder::new(permission_program)
            .permissioned_account(&game.to_account_info(), true)
            .authority(&game.to_account_info(), false)
            .permission(permission_game)
            .args(MembersArgs { members: None })
            .invoke_signed(&[&[
                GAME_SEED,
                &game.game_id.to_le_bytes(),
                &[ctx.bumps.game],
            ]])?;

        UpdatePermissionCpiBuilder::new(permission_program)
            .permissioned_account(&player1_state.to_account_info(), true)
            .authority(&player1_state.to_account_info(), false)
            .permission(permission1)
            .args(MembersArgs { members: None })
            .invoke_signed(&[&[
                PLAYER_STATE_SEED,
                &player1_state.game_id.to_le_bytes(),
                &player1_state.player.as_ref(),
                &[ctx.bumps.player1_state],
            ]])?;

        UpdatePermissionCpiBuilder::new(permission_program)
            .permissioned_account(&player2_state.to_account_info(), true)
            .authority(&player2_state.to_account_info(), false)
            .permission(permission2)
            .args(MembersArgs { members: None })
            .invoke_signed(&[&[
                PLAYER_STATE_SEED,
                &player2_state.game_id.to_le_bytes(),
                &player2_state.player.as_ref(),
                &[ctx.bumps.player2_state],
            ]])?;

        // Exit the program
        game.exit(&crate::ID)?;

        // Commit and undelegate accounts
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&game.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;

        Ok(())
    }

    /// Creates a permission based on account type input.
    /// Derives the bump from the account type and seeds, then calls the permission program.
    pub fn create_permission(
        ctx: Context<CreatePermission>,
        account_type: AccountType,
        members: Option<Vec<Member>>,
    ) -> Result<()> {
        let CreatePermission {
            permissioned_account,
            permission,
            payer,
            permission_program,
            system_program,
        } = ctx.accounts;

        let seed_data = derive_seeds_from_account_type(&account_type);

        let (_, bump) = Pubkey::find_program_address(
            &seed_data.iter().map(|s| s.as_slice()).collect::<Vec<_>>(),
            &crate::ID,
        );

        let mut seeds = seed_data.clone();
        seeds.push(vec![bump]);
        let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();

        CreatePermissionCpiBuilder::new(&permission_program)
            .permissioned_account(&permissioned_account.to_account_info())
            .permission(&permission)
            .payer(&payer)
            .system_program(&system_program)
            .args(MembersArgs { members })
            .invoke_signed(&[seed_refs.as_slice()])?;

        Ok(())
    }

    /// Delegate account to PER
    #[delegate]
    pub fn delegate_pda(ctx: Context<DelegatePda>, account_type: AccountType) -> Result<()> {
        let seed_data = derive_seeds_from_account_type(&account_type);
        let seeds_refs: Vec<&[u8]> = seed_data.iter().map(|s| s.as_slice()).collect();

        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &seeds_refs,
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

}

// Account Structures

#[account]
pub struct Game {
    pub game_id: u64,
    pub player1: Option<Pubkey>,
    pub player2: Option<Pubkey>,
    pub buy_in: u64,
    pub pot_amount: u64,
    pub small_blind: u64,
    pub big_blind: u64,
    pub current_turn: Option<Pubkey>,
    pub phase: GamePhase,
    pub board_cards: [u8; 5], // Public board cards
    pub deck_seed: [u8; 32],  // VRF seed for deck
    pub last_action_ts: i64,
    pub winner: Option<Pubkey>,
}

impl Game {
    pub const LEN: usize = 8 // discriminator
        + 8 // game_id
        + (1 + 32) // player1
        + (1 + 32) // player2
        + 8 // buy_in
        + 8 // pot_amount
        + 8 // small_blind
        + 8 // big_blind
        + (1 + 32) // current_turn
        + 1 // phase
        + 5 // board_cards
        + 32 // deck_seed
        + 8 // last_action_ts
        + (1 + 32); // winner
}

#[account]
pub struct PlayerState {
    pub game_id: u64,
    pub player: Pubkey,
    pub chips_committed: u64,
    pub has_folded: bool,
    pub hand: [u8; 2], // Encrypted via PER
}

impl PlayerState {
    pub const LEN: usize = 8 // discriminator
        + 8 // game_id
        + 32 // player
        + 8 // chips_committed
        + 1 // has_folded
        + 2; // hand
}

// Enums

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum GamePhase {
    Waiting,
    PreFlop,
    Flop,
    Turn,
    River,
    Showdown,
    Finished,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum PlayerActionType {
    Fold,
    Check,
    Call,
    Bet,
}


// Contexts

#[derive(Accounts)]
#[instruction(game_id: u64, buy_in: u64)]
pub struct InitializeGame<'info> {
    #[account(
        init,
        payer = player1,
        space = 8 + Game::LEN,
        seeds = [GAME_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,

    #[account(
        init,
        payer = player1,
        space = 8 + PlayerState::LEN,
        seeds = [PLAYER_STATE_SEED, &game_id.to_le_bytes(), player1.key().as_ref()],
        bump
    )]
    pub player1_state: Account<'info, PlayerState>,

    /// CHECK: Vault PDA
    #[account(
        mut,
        seeds = [GAME_VAULT_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game_vault: SystemAccount<'info>,

    #[account(mut)]
    pub player1: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct JoinGame<'info> {
    #[account(
        mut,
        seeds = [GAME_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,

    #[account(
        init,
        payer = player2,
        space = 8 + PlayerState::LEN,
        seeds = [PLAYER_STATE_SEED, &game_id.to_le_bytes(), player2.key().as_ref()],
        bump
    )]
    pub player2_state: Account<'info, PlayerState>,

    /// CHECK: Vault PDA
    #[account(
        mut,
        seeds = [GAME_VAULT_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game_vault: SystemAccount<'info>,

    #[account(mut)]
    pub player2: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct SetDeckSeed<'info> {
    #[account(
        mut,
        seeds = [GAME_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,

    pub payer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DealCards<'info> {
    #[account(
        mut,
        seeds = [GAME_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, &game_id.to_le_bytes(), game.player1.unwrap().as_ref()],
        bump
    )]
    pub player1_state: Account<'info, PlayerState>,

    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, &game_id.to_le_bytes(), game.player2.unwrap().as_ref()],
        bump
    )]
    pub player2_state: Account<'info, PlayerState>,

    pub payer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct PlayerAction<'info> {
    #[account(
        mut,
        seeds = [GAME_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, &game_id.to_le_bytes(), game.player1.unwrap().as_ref()],
        bump
    )]
    pub player1_state: Account<'info, PlayerState>,

    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, &game_id.to_le_bytes(), game.player2.unwrap().as_ref()],
        bump
    )]
    pub player2_state: Account<'info, PlayerState>,

    /// CHECK: Vault PDA
    #[account(
        mut,
        seeds = [GAME_VAULT_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game_vault: SystemAccount<'info>,

    #[account(mut)]
    pub player: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct AdvancePhase<'info> {
    #[account(
        mut,
        seeds = [GAME_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, &game_id.to_le_bytes(), game.player1.unwrap().as_ref()],
        bump
    )]
    pub player1_state: Account<'info, PlayerState>,

    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, &game_id.to_le_bytes(), game.player2.unwrap().as_ref()],
        bump
    )]
    pub player2_state: Account<'info, PlayerState>,

    pub payer: Signer<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct ResolveGame<'info> {
    #[account(
        mut,
        seeds = [GAME_SEED, &game.game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, &game.game_id.to_le_bytes(), game.player1.unwrap().as_ref()],
        bump
    )]
    pub player1_state: Account<'info, PlayerState>,

    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, &game.game_id.to_le_bytes(), game.player2.unwrap().as_ref()],
        bump
    )]
    pub player2_state: Account<'info, PlayerState>,

    /// CHECK: Vault PDA
    #[account(
        mut,
        seeds = [GAME_VAULT_SEED, &game.game_id.to_le_bytes()],
        bump
    )]
    pub game_vault: SystemAccount<'info>,

    /// CHECK: Winner account
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,

    /// CHECK: Permission accounts (checked by permission program)
    #[account(mut)]
    pub permission_game: UncheckedAccount<'info>,

    /// CHECK: Permission account for player1 (checked by permission program)
    #[account(mut)]
    pub permission1: UncheckedAccount<'info>,

    /// CHECK: Permission account for player2 (checked by permission program)
    #[account(mut)]
    pub permission2: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: PERMISSION PROGRAM
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,

    /// CHECK: Magic program
    pub magic_program: UncheckedAccount<'info>,

    /// CHECK: Magic context
    pub magic_context: UncheckedAccount<'info>,
}

// Error Codes

#[error_code]
pub enum PokerError {
    #[msg("You cannot join your own game.")]
    CannotJoinOwnGame,
    #[msg("Game is already full.")]
    GameFull,
    #[msg("Invalid game phase for this action.")]
    InvalidGamePhase,
    #[msg("It is not your turn.")]
    NotYourTurn,
    #[msg("Player has already folded.")]
    PlayerFolded,
    #[msg("Cannot check in this situation.")]
    CannotCheck,
    #[msg("Invalid action.")]
    InvalidAction,
    #[msg("Bet amount is too small.")]
    BetTooSmall,
    #[msg("Action is still pending.")]
    ActionPending,
    #[msg("Opponent not found.")]
    MissingOpponent,
    #[msg("Invalid winner.")]
    InvalidWinner,
}

// Helper types and functions for permissions

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AccountType {
    Game { game_id: u64 },
    PlayerState { game_id: u64, player: Pubkey },
}

fn derive_seeds_from_account_type(account_type: &AccountType) -> Vec<Vec<u8>> {
    match account_type {
        AccountType::Game { game_id } => {
            vec![GAME_SEED.to_vec(), game_id.to_le_bytes().to_vec()]
        }
        AccountType::PlayerState { game_id, player } => {
            vec![
                PLAYER_STATE_SEED.to_vec(),
                game_id.to_le_bytes().to_vec(),
                player.to_bytes().to_vec(),
            ]
        }
    }
}

#[derive(Accounts)]
pub struct CreatePermission<'info> {
    /// CHECK: Validated via permission program CPI
    pub permissioned_account: UncheckedAccount<'info>,

    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: PERMISSION PROGRAM
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegatePda<'info> {
    /// CHECK: The PDA to delegate
    #[account(mut, del)]
    pub pda: AccountInfo<'info>,

    pub payer: Signer<'info>,

    /// CHECK: Checked by the delegate program
    pub validator: Option<AccountInfo<'info>>,
}

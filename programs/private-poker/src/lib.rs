use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::{
    CommitAndUndelegatePermissionCpiBuilder, CreatePermissionCpiBuilder, UpdatePermissionCpiBuilder,
};
use ephemeral_rollups_sdk::access_control::structs::{Member, MembersArgs};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::consts::PERMISSION_PROGRAM_ID;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
// VRF SDK temporarily disabled - using client-side random seed for now
// TODO: Re-enable VRF when SDK compatibility is resolved

declare_id!("8aX9U5f1GMVXcwTy2z8ycTZc4fXxAMZyZbGkuC8Gjm2E");

// MagicBlock Program IDs (PERMISSION_PROGRAM_ID is imported from SDK)
use anchor_lang::solana_program::pubkey;
const DELEGATION_PROGRAM_ID: Pubkey = pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

// Seeds
const GAME_SEED: &[u8] = b"game";
const PLAYER_STATE_SEED: &[u8] = b"player_state";
const GAME_VAULT_SEED: &[u8] = b"game_vault";

// Poker hand evaluation
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum HandRank {
    HighCard = 1,
    Pair = 2,
    TwoPair = 3,
    ThreeOfAKind = 4,
    Straight = 5,
    Flush = 6,
    FullHouse = 7,
    FourOfAKind = 8,
    StraightFlush = 9,
    RoyalFlush = 10,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HandEvaluation {
    pub rank: HandRank,
    pub rank_value: u8, // For comparing same rank (e.g., pair of 10s vs pair of 5s)
    pub kickers: [u8; 4], // Remaining cards for tie-breaking
}

impl HandEvaluation {
    pub fn compare(&self, other: &HandEvaluation) -> std::cmp::Ordering {
        // First compare rank
        match self.rank.cmp(&other.rank) {
            std::cmp::Ordering::Equal => {
                // If same rank, compare rank_value
                match self.rank_value.cmp(&other.rank_value) {
                    std::cmp::Ordering::Equal => {
                        // If still equal, compare kickers
                        for i in 0..4 {
                            match self.kickers[i].cmp(&other.kickers[i]) {
                                std::cmp::Ordering::Equal => continue,
                                other => return other.reverse(), // Higher kicker wins
                            }
                        }
                        std::cmp::Ordering::Equal
                    }
                    other => other.reverse(), // Higher rank_value wins
                }
            }
            other => other.reverse(), // Higher rank wins
        }
    }
}

// Helper function to get card rank (0-12) and suit (0-3) from card value (0-51)
fn card_rank(card: u8) -> u8 {
    card % 13
}

fn card_suit(card: u8) -> u8 {
    card / 13
}

// Evaluate the best 5-card hand from 7 cards (2 hole + 5 board)
fn evaluate_best_hand(hole_cards: [u8; 2], board_cards: [u8; 5]) -> HandEvaluation {
    let mut all_cards = [0u8; 7];
    all_cards[0] = hole_cards[0];
    all_cards[1] = hole_cards[1];
    all_cards[2] = board_cards[0];
    all_cards[3] = board_cards[1];
    all_cards[4] = board_cards[2];
    all_cards[5] = board_cards[3];
    all_cards[6] = board_cards[4];
    
    let mut best_hand = evaluate_hand([all_cards[0], all_cards[1], all_cards[2], all_cards[3], all_cards[4]]);
    
    // Try all combinations of 5 cards from 7
    for i in 0..7 {
        for j in (i + 1)..7 {
            let mut hand = [0u8; 5];
            let mut idx = 0;
            for k in 0..7 {
                if k != i && k != j {
                    hand[idx] = all_cards[k];
                    idx += 1;
                }
            }
            let eval = evaluate_hand(hand);
            if eval.compare(&best_hand) == std::cmp::Ordering::Greater {
                best_hand = eval;
            }
        }
    }
    
    best_hand
}

// Evaluate a 5-card hand
fn evaluate_hand(mut cards: [u8; 5]) -> HandEvaluation {
    // Sort cards by rank
    cards.sort_by(|a, b| card_rank(*a).cmp(&card_rank(*b)));
    
    let ranks: Vec<u8> = cards.iter().map(|&c| card_rank(c)).collect();
    let suits: Vec<u8> = cards.iter().map(|&c| card_suit(c)).collect();
    
    // Check for flush
    let is_flush = suits[0] == suits[1] && suits[1] == suits[2] && suits[2] == suits[3] && suits[3] == suits[4];
    
    // Check for A-2-3-4-5 straight (wheel) - Ace low
    let is_wheel = ranks == [0, 1, 2, 3, 12];
    // Check for 10-J-Q-K-A straight (Ace high)
    let is_broadway = ranks == [8, 9, 10, 11, 12];
    
    // Check for straight
    let mut is_straight = true;
    for i in 1..5 {
        if ranks[i] != ranks[i - 1] + 1 {
            is_straight = false;
            break;
        }
    }
    
    // Royal flush: 10-J-Q-K-A of same suit
    if is_flush && is_broadway {
        return HandEvaluation {
            rank: HandRank::RoyalFlush,
            rank_value: 12,
            kickers: [0; 4],
        };
    }
    
    // Straight flush
    if is_flush && (is_straight || is_wheel || is_broadway) {
        let rank_value = if is_wheel { 3 } else if is_broadway { 12 } else { ranks[4] };
        return HandEvaluation {
            rank: HandRank::StraightFlush,
            rank_value,
            kickers: [0; 4],
        };
    }
    
    // Count occurrences of each rank
    let mut rank_counts = [0u8; 13];
    for &rank in &ranks {
        rank_counts[rank as usize] += 1;
    }
    
    let mut pairs = Vec::new();
    let mut three_kind = None;
    let mut four_kind = None;
    
    for (rank, &count) in rank_counts.iter().enumerate() {
        match count {
            2 => pairs.push(rank as u8),
            3 => three_kind = Some(rank as u8),
            4 => four_kind = Some(rank as u8),
            _ => {}
        }
    }
    
    // Four of a kind
    if let Some(rank) = four_kind {
        let kicker = ranks.iter().find(|&&r| r != rank).copied().unwrap_or(0);
        return HandEvaluation {
            rank: HandRank::FourOfAKind,
            rank_value: rank,
            kickers: [kicker, 0, 0, 0],
        };
    }
    
    // Full house
    if let Some(three) = three_kind {
        if let Some(pair) = pairs.first() {
            return HandEvaluation {
                rank: HandRank::FullHouse,
                rank_value: three,
                kickers: [*pair, 0, 0, 0],
            };
        }
    }
    
    // Flush
    if is_flush {
        return HandEvaluation {
            rank: HandRank::Flush,
            rank_value: ranks[4],
            kickers: [ranks[3], ranks[2], ranks[1], ranks[0]],
        };
    }
    
    // Straight
    if is_straight || is_wheel || is_broadway {
        let rank_value = if is_wheel { 3 } else if is_broadway { 12 } else { ranks[4] };
        return HandEvaluation {
            rank: HandRank::Straight,
            rank_value,
            kickers: [0; 4],
        };
    }
    
    // Three of a kind
    if let Some(rank) = three_kind {
        let mut kickers = [0u8; 4];
        let mut idx = 0;
        for &r in &ranks {
            if r != rank {
                kickers[idx] = r;
                idx += 1;
            }
        }
        return HandEvaluation {
            rank: HandRank::ThreeOfAKind,
            rank_value: rank,
            kickers,
        };
    }
    
    // Two pair
    if pairs.len() >= 2 {
        pairs.sort();
        let high_pair = pairs[pairs.len() - 1];
        let low_pair = pairs[pairs.len() - 2];
        let kicker = ranks.iter().find(|&&r| r != high_pair && r != low_pair).copied().unwrap_or(0);
        return HandEvaluation {
            rank: HandRank::TwoPair,
            rank_value: high_pair,
            kickers: [low_pair, kicker, 0, 0],
        };
    }
    
    // Pair
    if let Some(&pair_rank) = pairs.first() {
        let mut kickers = [0u8; 4];
        let mut idx = 0;
        for &r in &ranks {
            if r != pair_rank {
                kickers[idx] = r;
                idx += 1;
            }
        }
        return HandEvaluation {
            rank: HandRank::Pair,
            rank_value: pair_rank,
            kickers,
        };
    }
    
    // High card
    HandEvaluation {
        rank: HandRank::HighCard,
        rank_value: ranks[4],
        kickers: [ranks[3], ranks[2], ranks[1], ranks[0]],
    }
}

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
        // chips_committed starts at 0, will be set to small_blind when player2 joins
        let player_state = &mut ctx.accounts.player1_state;
        player_state.game_id = game_id;
        player_state.player = player1;
        player_state.chips_committed = 0;
        player_state.has_folded = false;
        player_state.hand = [0u8; 2];

        msg!("Game {} initialized by player {}", game_id, player1);

        Ok(())
    }

    /// Second player joins the game
    pub fn join_game(ctx: Context<JoinGame>, game_id: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player2 = ctx.accounts.player2.key();
        let player1 = game.player1.ok_or(PokerError::MissingOpponent)?;

        // Verify player1_state is the correct PDA for game.player1
        let (expected_player1_state, _) = Pubkey::find_program_address(
            &[
                PLAYER_STATE_SEED,
                &game_id.to_le_bytes(),
                player1.as_ref(),
            ],
            ctx.program_id,
        );
        require!(
            ctx.accounts.player1_state.key() == expected_player1_state,
            PokerError::InvalidAction
        );
        
        // Verify player1_state belongs to this game and player
        require!(
            ctx.accounts.player1_state.game_id == game_id,
            PokerError::InvalidAction
        );
        require!(
            ctx.accounts.player1_state.player == player1,
            PokerError::InvalidAction
        );

        // Validation checks
        require!(game.player1 != Some(player2), PokerError::CannotJoinOwnGame);
        require!(game.player2.is_none(), PokerError::GameFull);
        require!(game.phase == GamePhase::Waiting, PokerError::InvalidGamePhase);

        // Update game state
        game.player2 = Some(player2);
        game.phase = GamePhase::PreFlop;
        game.current_turn = game.player1; // Small blind acts first

        // Transfer buy-in from player2 to vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.player2.to_account_info(),
                to: ctx.accounts.game_vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, game.buy_in)?;

        // Update player1_state to post small blind
        let player1_state = &mut ctx.accounts.player1_state;
        player1_state.chips_committed = game.small_blind;

        // Initialize player2_state with big blind
        let player2_state = &mut ctx.accounts.player2_state;
        player2_state.game_id = game_id;
        player2_state.player = player2;
        player2_state.chips_committed = game.big_blind;
        player2_state.has_folded = false;
        player2_state.hand = [0u8; 2];

        // Set pot to blinds (small blind + big blind)
        game.pot_amount = game.small_blind + game.big_blind;

        msg!("Player {} joined game {}", player2, game_id);

        Ok(())
    }

    /// Set deck seed (from VRF or commit-reveal)
    pub fn set_deck_seed(ctx: Context<SetDeckSeed>, _game_id: u64, seed: [u8; 32]) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.phase == GamePhase::PreFlop,
            PokerError::InvalidGamePhase
        );
        game.deck_seed = seed;
        msg!("Deck seed set for game {}", game.game_id);
        Ok(())
    }

    /// Shuffle and deal cards using client-generated random seed
    /// The seed is generated client-side using crypto.getRandomValues() for randomness
    pub fn shuffle_and_deal_cards(
        ctx: Context<ShuffleAndDealCards>,
        game_id: u64,
        random_seed: [u8; 32],
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        
        require!(
            game.phase == GamePhase::PreFlop,
            PokerError::InvalidGamePhase
        );
        require!(
            game.player1.is_some() && game.player2.is_some(),
            PokerError::MissingOpponent
        );

        msg!("Shuffling and dealing cards for game {} using client-generated random seed", game_id);

        // Combine client seed with game state for additional entropy
        let mut combined_seed = random_seed;
        // Overwrite first 8 bytes with game_id (client seed already has randomness)
        combined_seed[0..8].copy_from_slice(&game_id.to_le_bytes());
        // Use first 12 bytes of each player's pubkey (32 bytes total) to fill remaining space
        if let Some(p1) = game.player1 {
            let p1_bytes = p1.to_bytes();
            combined_seed[8..20].copy_from_slice(&p1_bytes[0..12]);
        }
        if let Some(p2) = game.player2 {
            let p2_bytes = p2.to_bytes();
            combined_seed[20..32].copy_from_slice(&p2_bytes[0..12]);
        }

        // Create full 52-card deck
        let mut deck: Vec<u8> = (0..52).collect();

        // Shuffle deck using Fisher-Yates with combined seed
        // Use improved LCG with better randomness distribution
        let mut rng_state = u64::from_le_bytes(combined_seed[0..8].try_into().unwrap())
            .wrapping_add(u64::from_le_bytes(combined_seed[8..16].try_into().unwrap()))
            .wrapping_add(u64::from_le_bytes(combined_seed[16..24].try_into().unwrap()))
            .wrapping_add(u64::from_le_bytes(combined_seed[24..32].try_into().unwrap()));
        
        // Ensure rng_state is non-zero to avoid degenerate sequences
        if rng_state == 0 {
            rng_state = 1;
        }
        
        for i in (1..52).rev() {
            // Improved LCG with multiple iterations for better distribution
            rng_state = rng_state.wrapping_mul(1103515245).wrapping_add(12345);
            // Add additional mixing
            rng_state = rng_state.wrapping_mul(1664525).wrapping_add(1013904223);
            // Use modulo to get index in range [0, i]
            let j = (rng_state as usize) % (i + 1);
            deck.swap(i, j);
        }
        
        // Verify deck has all unique cards 0-51 (sanity check)
        let mut deck_sorted = deck.clone();
        deck_sorted.sort();
        for i in 0..52 {
            require!(deck_sorted[i] == i as u8, PokerError::InvalidAction);
        }

        // Deal first 2 cards to player1, next 2 to player2
        let player1_hand = [deck[0], deck[1]];
        let player2_hand = [deck[2], deck[3]];

        // Comprehensive validation: ensure all cards are unique
        // Check player1's cards are different
        require!(
            player1_hand[0] != player1_hand[1],
            PokerError::InvalidAction
        );
        // Check player2's cards are different
        require!(
            player2_hand[0] != player2_hand[1],
            PokerError::InvalidAction
        );
        // Check player1's cards don't match player2's cards
        require!(
            player1_hand[0] != player2_hand[0],
            PokerError::InvalidAction
        );
        require!(
            player1_hand[0] != player2_hand[1],
            PokerError::InvalidAction
        );
        require!(
            player1_hand[1] != player2_hand[0],
            PokerError::InvalidAction
        );
        require!(
            player1_hand[1] != player2_hand[1],
            PokerError::InvalidAction
        );
        
        // Additional validation: ensure cards are in valid range
        for &card in player1_hand.iter().chain(player2_hand.iter()) {
            require!(card < 52, PokerError::InvalidAction);
        }
        
        msg!(
            "Deck shuffled: P1=[{}, {}], P2=[{}, {}], All unique: true",
            player1_hand[0],
            player1_hand[1],
            player2_hand[0],
            player2_hand[1]
        );

        // Store the combined seed in game state so we can regenerate the deck later
        game.deck_seed = combined_seed;

        // Assign cards to players
        let player1_state = &mut ctx.accounts.player1_state;
        let player2_state = &mut ctx.accounts.player2_state;

        msg!(
            "Before assignment: P1 hand=[{}, {}], P2 hand=[{}, {}]",
            player1_state.hand[0],
            player1_state.hand[1],
            player2_state.hand[0],
            player2_state.hand[1]
        );
        msg!(
            "Assigning: P1=[{}, {}], P2=[{}, {}]",
            player1_hand[0],
            player1_hand[1],
            player2_hand[0],
            player2_hand[1]
        );

        player1_state.hand = player1_hand;
        player2_state.hand = player2_hand;

        msg!(
            "After assignment: P1 hand=[{}, {}], P2 hand=[{}, {}], P1 pubkey={}, P2 pubkey={}",
            player1_state.hand[0],
            player1_state.hand[1],
            player2_state.hand[0],
            player2_state.hand[1],
            player1_state.player,
            player2_state.player
        );

        Ok(())
    }

    /// Player action: Bet, Call, Fold, or Check
    pub fn player_action(
        ctx: Context<PlayerAction>,
        _game_id: u64,
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

        // Read values before getting mutable references
        let is_player1 = player == game.player1.unwrap();
        let player_folded = if is_player1 {
            ctx.accounts.player1_state.has_folded
        } else {
            ctx.accounts.player2_state.has_folded
        };
        require!(!player_folded, PokerError::PlayerFolded);

        // Get other player's chips_committed for call calculation (read-only)
        let other_chips = if is_player1 {
            ctx.accounts.player2_state.chips_committed
        } else {
            ctx.accounts.player1_state.chips_committed
        };

        // Now get mutable reference to player state
        let player_state = if is_player1 {
            &mut ctx.accounts.player1_state
        } else {
            &mut ctx.accounts.player2_state
        };

        match action {
            PlayerActionType::Fold => {
                player_state.has_folded = true;
                msg!("Player {} folded", player);
            }
            PlayerActionType::Check => {
                // In single round MVP, check is allowed if chips are already equal
                require!(
                    player_state.chips_committed == other_chips,
                    PokerError::CannotCheck
                );
                msg!("Player {} checked", player);
            }
            PlayerActionType::Call => {
                let call_amount = other_chips.saturating_sub(player_state.chips_committed);
                require!(call_amount > 0, PokerError::InvalidAction);
                
                // Validate that new chips_committed doesn't exceed buy_in
                let new_chips_committed = player_state.chips_committed + call_amount;
                require!(new_chips_committed <= game.buy_in, PokerError::InvalidAction);
                
                player_state.chips_committed = new_chips_committed;
                game.pot_amount += call_amount;

                // No wallet transfer - money is already in vault from buy-in
                msg!("Player {} called {} (from buy-in)", player, call_amount);
            }
            PlayerActionType::Bet => {
                let bet_amount = amount.ok_or(PokerError::InvalidAction)?;
                require!(bet_amount >= game.big_blind, PokerError::BetTooSmall);
                
                // Validate that new chips_committed doesn't exceed buy_in
                let new_chips_committed = player_state.chips_committed + bet_amount;
                require!(new_chips_committed <= game.buy_in, PokerError::InvalidAction);
                
                player_state.chips_committed = new_chips_committed;
                game.pot_amount += bet_amount;

                // No wallet transfer - money is already in vault from buy-in
                msg!("Player {} bet {} (from buy-in)", player, bet_amount);
            }
        }

        // Update last action timestamp
        game.last_action_ts = Clock::get()?.unix_timestamp;

        // Single round MVP: Automatically advance phase after both players have acted
        // Get current state of both players (read-only for comparison)
        let p1_chips = ctx.accounts.player1_state.chips_committed;
        let p2_chips = ctx.accounts.player2_state.chips_committed;
        let p1_folded = ctx.accounts.player1_state.has_folded;
        let p2_folded = ctx.accounts.player2_state.has_folded;
        let is_player1 = player == game.player1.unwrap();
        let is_player2 = player == game.player2.unwrap();

        // Determine if we should advance phase:
        // 1. Someone folded -> advance immediately
        // 2. Both players have equal chips committed (betting round complete)
        //    - If player 1 just acted: wait for player 2 to act
        //    - If player 2 just acted: both have acted, advance
        let should_advance = if p1_folded || p2_folded {
            true // Someone folded, advance immediately
        } else if p1_chips == p2_chips {
            // Chips are equal - advance if player 2 just acted (both have acted)
            is_player2
        } else {
            false // Chips not equal yet, don't advance
        };

        if should_advance {
            // Automatically advance phase and deal board cards from shuffled deck
            match game.phase {
                GamePhase::PreFlop => {
                    // Verify deck seed is set (cards were shuffled)
                    require!(
                        !game.deck_seed.iter().all(|&b| b == 0),
                        PokerError::InvalidAction
                    );
                    
                    // Regenerate the same shuffled deck from stored seed
                    let mut deck: Vec<u8> = (0..52).collect();
                    let mut rng_state = u64::from_le_bytes(game.deck_seed[0..8].try_into().unwrap())
                        .wrapping_add(u64::from_le_bytes(game.deck_seed[8..16].try_into().unwrap()))
                        .wrapping_add(u64::from_le_bytes(game.deck_seed[16..24].try_into().unwrap()))
                        .wrapping_add(u64::from_le_bytes(game.deck_seed[24..32].try_into().unwrap()));
                    for i in (1..52).rev() {
                        rng_state = rng_state.wrapping_mul(1103515245).wrapping_add(12345);
                        let j = (rng_state as usize) % (i + 1);
                        deck.swap(i, j);
                    }
                    
                    // Deal Flop: cards at positions 4, 5, 6 (after player hands at 0-3)
                    let flop_cards = [deck[4], deck[5], deck[6]];
                    
                    // Validate board cards don't conflict with player hands
                    let p1_hand = ctx.accounts.player1_state.hand;
                    let p2_hand = ctx.accounts.player2_state.hand;
                    for &card in &flop_cards {
                        require!(card != p1_hand[0] && card != p1_hand[1], PokerError::InvalidAction);
                        require!(card != p2_hand[0] && card != p2_hand[1], PokerError::InvalidAction);
                    }
                    
                    game.board_cards[0] = flop_cards[0];
                    game.board_cards[1] = flop_cards[1];
                    game.board_cards[2] = flop_cards[2];
                    
                    game.phase = GamePhase::Flop;
                    game.current_turn = game.player1;
                    msg!("Game {} advanced to Flop, board cards: [{}, {}, {}]", 
                         game.game_id, flop_cards[0], flop_cards[1], flop_cards[2]);
                }
                GamePhase::Flop => {
                    // Regenerate the same shuffled deck from stored seed
                    let mut deck: Vec<u8> = (0..52).collect();
                    let mut rng_state = u64::from_le_bytes(game.deck_seed[0..8].try_into().unwrap())
                        .wrapping_add(u64::from_le_bytes(game.deck_seed[8..16].try_into().unwrap()))
                        .wrapping_add(u64::from_le_bytes(game.deck_seed[16..24].try_into().unwrap()))
                        .wrapping_add(u64::from_le_bytes(game.deck_seed[24..32].try_into().unwrap()));
                    for i in (1..52).rev() {
                        rng_state = rng_state.wrapping_mul(1103515245).wrapping_add(12345);
                        let j = (rng_state as usize) % (i + 1);
                        deck.swap(i, j);
                    }
                    
                    // Deal Turn: card at position 7
                    let turn_card = deck[7];
                    
                    // Validate turn card doesn't conflict with player hands or existing board cards
                    let p1_hand = ctx.accounts.player1_state.hand;
                    let p2_hand = ctx.accounts.player2_state.hand;
                    require!(turn_card != p1_hand[0] && turn_card != p1_hand[1], PokerError::InvalidAction);
                    require!(turn_card != p2_hand[0] && turn_card != p2_hand[1], PokerError::InvalidAction);
                    require!(turn_card != game.board_cards[0] && turn_card != game.board_cards[1] && turn_card != game.board_cards[2], PokerError::InvalidAction);
                    
                    game.board_cards[3] = turn_card;
                    
                    game.phase = GamePhase::Turn;
                    game.current_turn = game.player1;
                    msg!("Game {} advanced to Turn, board card: {}", game.game_id, turn_card);
                }
                GamePhase::Turn => {
                    // Regenerate the same shuffled deck from stored seed
                    let mut deck: Vec<u8> = (0..52).collect();
                    let mut rng_state = u64::from_le_bytes(game.deck_seed[0..8].try_into().unwrap())
                        .wrapping_add(u64::from_le_bytes(game.deck_seed[8..16].try_into().unwrap()))
                        .wrapping_add(u64::from_le_bytes(game.deck_seed[16..24].try_into().unwrap()))
                        .wrapping_add(u64::from_le_bytes(game.deck_seed[24..32].try_into().unwrap()));
                    for i in (1..52).rev() {
                        rng_state = rng_state.wrapping_mul(1103515245).wrapping_add(12345);
                        let j = (rng_state as usize) % (i + 1);
                        deck.swap(i, j);
                    }
                    
                    // Deal River: card at position 8
                    let river_card = deck[8];
                    
                    // Validate river card doesn't conflict with player hands or existing board cards
                    let p1_hand = ctx.accounts.player1_state.hand;
                    let p2_hand = ctx.accounts.player2_state.hand;
                    require!(river_card != p1_hand[0] && river_card != p1_hand[1], PokerError::InvalidAction);
                    require!(river_card != p2_hand[0] && river_card != p2_hand[1], PokerError::InvalidAction);
                    require!(
                        river_card != game.board_cards[0] && river_card != game.board_cards[1] && 
                        river_card != game.board_cards[2] && river_card != game.board_cards[3],
                        PokerError::InvalidAction
                    );
                    
                    game.board_cards[4] = river_card;
                    
                    game.phase = GamePhase::River;
                    game.current_turn = game.player1;
                    msg!("Game {} advanced to River, board card: {}", game.game_id, river_card);
                }
                GamePhase::River => {
                    game.phase = GamePhase::Showdown;
                    game.current_turn = None;
                    msg!("Game {} advanced to Showdown", game.game_id);
                    
                    // Auto-resolve if both players are still in (not folded)
                    if !p1_folded && !p2_folded {
                        // Determine winner by comparing hands
                        let p1_hand = ctx.accounts.player1_state.hand;
                        let p2_hand = ctx.accounts.player2_state.hand;
                        let board = game.board_cards;
                        
                        let p1_eval = evaluate_best_hand(p1_hand, board);
                        let p2_eval = evaluate_best_hand(p2_hand, board);
                        
                        let winner = if p1_eval.compare(&p2_eval) == std::cmp::Ordering::Greater {
                            game.player1.unwrap()
                        } else if p2_eval.compare(&p1_eval) == std::cmp::Ordering::Greater {
                            game.player2.unwrap()
                        } else {
                            // Tie - player 1 wins by default (or could split pot)
                            game.player1.unwrap()
                        };
                        
                        game.winner = Some(winner);
                        msg!("Showdown: P1 hand rank={:?}, P2 hand rank={:?}, Winner={}", 
                             p1_eval.rank, p2_eval.rank, winner);
                    }
                }
                _ => {
                    // Don't advance if already in Showdown or Finished
                }
            }
        } else {
            // Switch turn to next player (if player 1 acted, switch to player 2)
            game.current_turn = if is_player1 {
                game.player2
            } else {
                game.player1
            };
        }

        Ok(())
    }

    /// Advance game phase (PreFlop -> Flop -> Turn -> River -> Showdown)
    pub fn advance_phase(ctx: Context<AdvancePhase>, _game_id: u64) -> Result<()> {
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
    pub fn resolve_game(ctx: Context<ResolveGame>, _winner: Pubkey) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player1_state = &ctx.accounts.player1_state;
        let player2_state = &ctx.accounts.player2_state;

        require!(
            game.phase == GamePhase::Showdown || game.phase == GamePhase::Finished,
            PokerError::InvalidGamePhase
        );

        // Determine winner automatically
        let actual_winner = if player1_state.has_folded {
            game.player2.ok_or(PokerError::MissingOpponent)?
        } else if player2_state.has_folded {
            game.player1.ok_or(PokerError::MissingOpponent)?
        } else {
            // Both players still in - compare hands
            // Winner should already be set in Showdown phase, but recalculate to be sure
            if let Some(winner) = game.winner {
                winner
            } else {
                // Calculate winner from hands
                let p1_hand = player1_state.hand;
                let p2_hand = player2_state.hand;
                let board = game.board_cards;
                
                let p1_eval = evaluate_best_hand(p1_hand, board);
                let p2_eval = evaluate_best_hand(p2_hand, board);
                
                if p1_eval.compare(&p2_eval) == std::cmp::Ordering::Greater {
                    game.player1.ok_or(PokerError::MissingOpponent)?
                } else if p2_eval.compare(&p1_eval) == std::cmp::Ordering::Greater {
                    game.player2.ok_or(PokerError::MissingOpponent)?
                } else {
                    // Tie - player 1 wins by default
                    game.player1.ok_or(PokerError::MissingOpponent)?
                }
            }
        };

        let game_id = game.game_id;
        
        // PDA seeds for the vault
        let seeds = &[
            GAME_VAULT_SEED,
            &game_id.to_le_bytes(),
            &[ctx.bumps.game_vault],
        ];
        let signer_seeds = &[&seeds[..]];

        // Calculate unused buy-in for each player
        let p1_unused = game.buy_in.saturating_sub(player1_state.chips_committed);
        let p2_unused = game.buy_in.saturating_sub(player2_state.chips_committed);
        
        // Pot amount = total bets (chips_committed by both players)
        let pot_amount = game.pot_amount;

        // 1. Transfer pot to winner (only the amount that was bet)
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.game_vault.to_account_info(),
                    to: ctx.accounts.winner.to_account_info(),
                },
                signer_seeds,
            ),
            pot_amount,
        )?;

        // 2. Return unused buy-in to player 1
        if p1_unused > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.game_vault.to_account_info(),
                        to: ctx.accounts.player1.to_account_info(),
                    },
                    signer_seeds,
                ),
                p1_unused,
            )?;
        }

        // 3. Return unused buy-in to player 2
        if p2_unused > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.game_vault.to_account_info(),
                        to: ctx.accounts.player2.to_account_info(),
                    },
                    signer_seeds,
                ),
                p2_unused,
            )?;
        }

        game.phase = GamePhase::Finished;
        game.winner = Some(actual_winner);

        msg!("Game {} resolved. Winner: {} received pot: {} SOL. Player1 unused: {} SOL returned. Player2 unused: {} SOL returned.", 
             game.game_id, actual_winner, pot_amount, p1_unused, p2_unused);

        // Note: MagicBlock commit_and_undelegate_accounts removed due to CPI privilege issues
        // For MVP, we're skipping the commit/undelegate step
        // In production, you would need to properly configure magic_program and magic_context
        // and ensure all accounts are properly delegated to PER before the game starts

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
    pub game_vault: UncheckedAccount<'info>,

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

    /// Player1's state - we verify the PDA manually in the function
    /// because Anchor can't resolve seeds that depend on game.player1
    #[account(mut)]
    pub player1_state: Account<'info, PlayerState>,

    #[account(
        init,
        payer = player2,
        space = 8 + PlayerState::LEN,
        seeds = [
            PLAYER_STATE_SEED,
            &game_id.to_le_bytes(),
            player2.key().as_ref()
        ],
        bump
    )]
    pub player2_state: Account<'info, PlayerState>,

    /// CHECK: Vault PDA for holding game funds
    #[account(
        mut,
        seeds = [GAME_VAULT_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game_vault: UncheckedAccount<'info>,

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
pub struct ShuffleAndDealCards<'info> {
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
    pub game_vault: UncheckedAccount<'info>,

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
    pub game_vault: UncheckedAccount<'info>,

    /// CHECK: Winner account
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,

    /// CHECK: Player 1 account (to return unused buy-in)
    #[account(mut)]
    pub player1: UncheckedAccount<'info>,

    /// CHECK: Player 2 account (to return unused buy-in)
    #[account(mut)]
    pub player2: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
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

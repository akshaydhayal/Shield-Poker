# Join Game Fix - Complete Rewrite

## Problem
Multiple `AccountDiscriminatorMismatch`, `AccountNotInitialized`, and `AccountOwnedByWrongProgram` errors when player 2 tried to join a game.

## Root Cause
We were manually handling PDAs with `UncheckedAccount` and trying to do Anchor's job ourselves, which led to:
- Incorrect manual account initialization
- Missing/incorrect discriminators
- Complex error-prone logic
- Accounts not properly validated

## Solution: Let Anchor Do Its Job

### Program Changes (`lib.rs`)

#### 1. Simplified `JoinGame` struct
**Before** (Manual handling with `UncheckedAccount`):
```rust
pub struct JoinGame<'info> {
    pub game: Account<'info, Game>,
    pub player1: UncheckedAccount<'info>,           // ❌ Manual
    pub player1_state: UncheckedAccount<'info>,     // ❌ Manual
    pub player2_state: UncheckedAccount<'info>,     // ❌ Manual
    pub game_vault: UncheckedAccount<'info>,
    pub player2: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

**After** (Proper Anchor constraints):
```rust
pub struct JoinGame<'info> {
    #[account(
        mut,
        seeds = [GAME_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        seeds = [
            PLAYER_STATE_SEED,
            &game_id.to_le_bytes(),
            game.player1.unwrap().as_ref()
        ],
        bump
    )]
    pub player1_state: Account<'info, PlayerState>,  // ✅ Anchor validates

    #[account(
        init,                                         // ✅ Anchor initializes
        payer = player2,
        space = 8 + PlayerState::LEN,
        seeds = [
            PLAYER_STATE_SEED,
            &game_id.to_le_bytes(),
            player2.key().as_ref()
        ],
        bump
    )]
    pub player2_state: Account<'info, PlayerState>,  // ✅ Anchor creates

    #[account(
        mut,
        seeds = [GAME_VAULT_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game_vault: UncheckedAccount<'info>,         // ✅ Stays unchecked (holds lamports)

    #[account(mut)]
    pub player2: Signer<'info>,

    pub system_program: Program<'info, System>,
}
```

#### 2. Simplified `join_game` function
**Before** (100+ lines of manual validation, deserialization, creation):
```rust
pub fn join_game(ctx: Context<JoinGame>, game_id: u64) -> Result<()> {
    // Manual PDA verification
    // Manual ownership checks
    // Manual deserialization
    // Manual account creation
    // Manual discriminator writing
    // 100+ lines of error-prone code
}
```

**After** (Clean and simple):
```rust
pub fn join_game(ctx: Context<JoinGame>, game_id: u64) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player2 = ctx.accounts.player2.key();

    // Validation
    require!(game.player1 != Some(player2), PokerError::CannotJoinOwnGame);
    require!(game.player2.is_none(), PokerError::GameFull);
    require!(game.phase == GamePhase::Waiting, PokerError::InvalidGamePhase);

    // Update game
    game.player2 = Some(player2);
    game.phase = GamePhase::PreFlop;
    game.current_turn = game.player1;

    // Transfer buy-in
    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.player2.to_account_info(),
                to: ctx.accounts.game_vault.to_account_info(),
            },
        ),
        game.buy_in,
    )?;

    // Post blinds (Anchor handles all account initialization automatically)
    ctx.accounts.player1_state.chips_committed = game.small_blind;
    
    ctx.accounts.player2_state.game_id = game_id;
    ctx.accounts.player2_state.player = player2;
    ctx.accounts.player2_state.chips_committed = game.big_blind;
    ctx.accounts.player2_state.has_folded = false;
    ctx.accounts.player2_state.hand = [0u8; 2];

    // Set pot
    game.pot_amount = game.small_blind + game.big_blind;

    Ok(())
}
```

### Frontend Changes (`poker.ts`)

**Before**:
```typescript
// Fetch player1 from game
const player1Pubkey = currentGame.player1;
const [player1StatePda] = PublicKey.findProgramAddressSync(...);

// Pass all accounts manually
.accounts({
  game: gamePda,
  player1: player1Pubkey,        // ❌ Not needed
  player1State: player1StatePda, // ❌ Anchor derives this
  player2State: player2StatePda,
  gameVault: vaultPda,
  player2: this.wallet.publicKey,
  systemProgram: SystemProgram.programId,
})
```

**After**:
```typescript
// Only derive player2_state
const [player2StatePda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("player_state"),
    this.numberToLeBytes(gameId),
    this.wallet.publicKey.toBuffer(),
  ],
  this.program.programId
);

// Anchor derives player1_state automatically
.accounts({
  game: gamePda,
  player2State: player2StatePda,
  gameVault: vaultPda,
  player2: this.wallet.publicKey,
  systemProgram: SystemProgram.programId,
})
```

## What Anchor Does Automatically

1. **PDA Derivation**: Uses `seeds` and `bump` to derive and verify `player1_state`
2. **Account Initialization**: `init` on `player2_state` creates the account with correct space
3. **Discriminator**: Writes the correct 8-byte discriminator automatically
4. **Ownership**: Ensures accounts are owned by the correct program
5. **Space Calculation**: `8 + PlayerState::LEN` for discriminator + data
6. **Rent**: Automatically calculates and transfers rent-exempt lamports

## Benefits

✅ **Reduced code**: 100+ lines → 40 lines  
✅ **No manual errors**: Anchor handles all the complex stuff  
✅ **Type-safe**: `Account<'info, PlayerState>` ensures correct type  
✅ **Automatic validation**: Seeds, bumps, ownership all checked  
✅ **Correct discriminators**: Always written properly  
✅ **Maintainable**: Standard Anchor patterns  

## Testing

After this fix:
1. **Player 1** initializes game → ✅ Works
2. **Player 2** joins game → ✅ Works (no more discriminator errors)
3. **Blinds posted** → ✅ Small blind + big blind in pot
4. **Game advances** → ✅ Waiting → PreFlop

## Key Lesson

**Don't fight Anchor. Use its constraints system properly.**

When you need to:
- Reference existing accounts: Use `Account<'info, T>` with proper `seeds`
- Create new accounts: Use `init` constraint
- Let Anchor handle PDAs, discriminators, and validation

Only use `UncheckedAccount` when:
- Account doesn't have an Anchor type (like vault holding raw lamports)
- You really need to bypass Anchor's safety checks (rare)

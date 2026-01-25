# MagicBlock VRF Integration Guide

## Overview

MagicBlock provides VRF (Verifiable Randomness Function) for generating provably fair randomness on-chain. This is essential for fair card shuffling in poker games.

## Integration Steps

### 1. Add VRF Dependency

Update `programs/private-poker/Cargo.toml`:

```toml
[dependencies]
# ... existing dependencies
magicblock-vrf = { version = "0.1.0", features = ["anchor"] }
```

### 2. Request Randomness

In your program, request randomness from MagicBlock VRF:

```rust
use magicblock_vrf::instructions::RequestRandomness;

pub fn request_deck_shuffle(ctx: Context<RequestDeckShuffle>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    
    // Request randomness from VRF
    let cpi_accounts = RequestRandomness {
        vrf_account: ctx.accounts.vrf_account.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
        // ... other accounts
    };
    
    let cpi_ctx = CpiContext::new(
        ctx.accounts.vrf_program.to_account_info(),
        cpi_accounts,
    );
    
    magicblock_vrf::cpi::request_randomness(cpi_ctx, game.game_id)?;
    
    Ok(())
}
```

### 3. Consume Randomness

Once randomness is available, use it to shuffle the deck:

```rust
pub fn consume_randomness(ctx: Context<ConsumeRandomness>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let vrf_account = &ctx.accounts.vrf_account;
    
    // Get randomness value
    let randomness = vrf_account.get_randomness()?;
    
    // Use randomness to shuffle deck
    game.deck_seed = randomness;
    
    Ok(())
}
```

### 4. Shuffle Deck Algorithm

Use the VRF output to deterministically shuffle a 52-card deck:

```rust
fn shuffle_deck(seed: [u8; 32]) -> Vec<u8> {
    // Fisher-Yates shuffle using seed as entropy
    let mut deck: Vec<u8> = (0..52).collect();
    let mut rng = ChaChaRng::from_seed(seed);
    
    for i in (1..52).rev() {
        let j = rng.gen_range(0..=i);
        deck.swap(i, j);
    }
    
    deck
}
```

## Resources

- [MagicBlock VRF Documentation](https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/how-to-guide/quickstart)
- VRF Program ID: Check MagicBlock docs for latest program ID

## Current Status

⚠️ **Note**: VRF integration is planned but not yet implemented in the MVP. Currently, the deck seed is set manually via `set_deck_seed` instruction. For production, integrate MagicBlock VRF for provably fair randomness.

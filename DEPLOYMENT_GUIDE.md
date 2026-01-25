# Deployment Guide - Private Poker

## Quick Start

### 1. Deploy Program

```bash
# Make sure you're on devnet
solana config set --url devnet

# Check balance (need ~2-3 SOL for deployment)
solana balance

# If needed, get some SOL
solana airdrop 2

# Deploy
anchor deploy
```

**Important**: After deployment, Anchor will show a program ID. You need to update it in:
- `programs/private-poker/src/lib.rs` - `declare_id!()` macro
- `app/src/config.ts` - `PROGRAM_ID` constant

Then rebuild and redeploy:
```bash
anchor build
anchor deploy
```

### 2. Test Basic Functionality

```bash
# Run tests
anchor test

# Or test manually with Solana CLI
anchor test --skip-local-validator
```

### 3. Set Up Frontend

```bash
cd app
npm install
npm run dev
```

Visit `http://localhost:3000`

## Game Flow Implementation

### Step 1: Initialize Game (Player 1)

```typescript
// In your frontend
const gameId = Date.now();
const buyIn = 1_000_000_000; // 1 SOL in lamports

await pokerClient.initializeGame(gameId, buyIn);
```

### Step 2: Create Permissions

After game is initialized, create permissions for privacy:

```typescript
// Create permission for game account
await pokerClient.createPermission(
  gameId,
  { game: { gameId } },
  [
    {
      flags: AUTHORITY_FLAG | TX_LOGS_FLAG,
      pubkey: player1PublicKey,
    },
  ]
);
```

### Step 3: Join Game (Player 2)

```typescript
await pokerClient.joinGame(gameId);
```

### Step 4: Delegate to PER

After both players join, delegate accounts to PER:

```typescript
// Delegate game account
await pokerClient.delegatePda(
  gameId,
  { game: { gameId } },
  VALIDATORS.TEE // or your preferred validator
);

// Delegate player state accounts
await pokerClient.delegatePda(
  gameId,
  { playerState: { gameId, player: player1PublicKey } },
  VALIDATORS.TEE
);

await pokerClient.delegatePda(
  gameId,
  { playerState: { gameId, player: player2PublicKey } },
  VALIDATORS.TEE
);
```

### Step 5: Authorize TEE Access

```typescript
// Get authorization token
const authToken = await authorizeTee(
  wallet.publicKey,
  async (message) => {
    const signed = await wallet.signMessage(message);
    return signed;
  }
);

// Create TEE connection
const teeConnection = createTeeConnection(authToken.token);
```

### Step 6: Play Game

```typescript
// Set deck seed (from VRF or manual)
await pokerClient.setDeckSeed(gameId, deckSeed);

// Deal cards
await pokerClient.dealCards(gameId, player1Hand, player2Hand);

// Player actions
await pokerClient.playerAction(gameId, PlayerActionType.Bet, betAmount);
await pokerClient.playerAction(gameId, PlayerActionType.Call);
await pokerClient.playerAction(gameId, PlayerActionType.Fold);

// Advance phases
await pokerClient.advancePhase(gameId);

// Resolve game
await pokerClient.resolveGame(gameId, winnerPublicKey);
```

## Testing Checklist

- [ ] Program deploys successfully
- [ ] Program ID updated in all locations
- [ ] Can initialize game
- [ ] Can join game
- [ ] Can create permissions
- [ ] Can delegate accounts
- [ ] TEE authorization works
- [ ] Can set deck seed
- [ ] Can deal cards
- [ ] Can execute player actions
- [ ] Can advance phases
- [ ] Can resolve game
- [ ] Winner receives payout

## Common Issues

### Program ID Mismatch
**Error**: "Program account does not match"
**Fix**: Update program ID in all 3 locations and rebuild

### Insufficient SOL
**Error**: "Insufficient funds"
**Fix**: `solana airdrop 2`

### Permission Errors
**Error**: "Account not permissioned"
**Fix**: Ensure `create_permission` is called before delegation

### TEE Connection Fails
**Error**: "Authorization failed"
**Fix**: 
- Verify TEE endpoint is accessible
- Check wallet can sign messages
- Ensure token hasn't expired

## Next: Add Permission/Delegation to Game Flow

You'll want to automatically create permissions and delegate when the game starts. Consider adding this logic to `join_game` instruction so it happens automatically when player 2 joins.

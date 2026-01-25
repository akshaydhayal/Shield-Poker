# Next Steps - Private Poker Development Roadmap

## ✅ Completed
- [x] Project structure created
- [x] Anchor 0.32.1 configured
- [x] SDK 0.8.0 integrated
- [x] Program builds successfully
- [x] MagicBlock PER integration

## 🚀 Immediate Next Steps

### 1. Deploy Program to Devnet

```bash
# Make sure you're on devnet
solana config set --url devnet

# Check your wallet balance (need SOL for deployment)
solana balance

# If balance is low, airdrop some SOL
solana airdrop 2

# Deploy the program
anchor deploy

# Note the program ID from output and update:
# - Anchor.toml (already updated)
# - programs/private-poker/src/lib.rs (declare_id! macro)
# - app/src/config.ts (PROGRAM_ID constant)
```

### 2. Update Program ID

After deployment, update the program ID in:
- `programs/private-poker/src/lib.rs`:
```rust
declare_id!("YOUR_DEPLOYED_PROGRAM_ID");
```

- `app/src/config.ts`:
```typescript
export const PROGRAM_ID = new PublicKey("YOUR_DEPLOYED_PROGRAM_ID");
```

Then rebuild:
```bash
anchor build
anchor deploy  # Redeploy with correct ID
```

### 3. Test Core Functionality

Create and run tests:

```bash
# Run Anchor tests
anchor test

# Or manually test with Solana CLI
anchor test --skip-local-validator
```

### 4. Set Up Frontend

```bash
cd app
npm install
npm run dev
```

Visit `http://localhost:3000` and test:
- Wallet connection
- TEE authorization
- Game initialization
- Player actions

### 5. Implement Permission & Delegation Setup

Currently, the program has the structure but you need to:
- Add `create_permission` instruction calls when initializing game
- Add `delegate_pda` instruction calls to delegate accounts to PER
- Set up proper permission members (players should have access)

**Recommended approach:**
- Call `create_permission` in `initialize_game` for game account
- Call `delegate_pda` after both players join
- Set permission members to include both players

### 6. Add VRF Integration (Optional for MVP)

For fair card shuffling:
- Integrate MagicBlock VRF
- See `VRF_INTEGRATION.md` for details
- Or use commit-reveal scheme for MVP

### 7. Test Full Game Flow

1. **Player 1**: Initialize game
2. **Player 2**: Join game
3. **Both**: Create permissions and delegate to PER
4. **System**: Deal cards (using VRF or manual seed)
5. **Players**: Take actions (bet, call, fold, check)
6. **System**: Advance phases
7. **System**: Resolve game and payout

## 📋 Priority Checklist

### High Priority (MVP)
- [ ] Deploy to devnet
- [ ] Update program IDs
- [ ] Test basic game initialization
- [ ] Test player join
- [ ] Set up permissions and delegation
- [ ] Test TEE connection from frontend
- [ ] Test one complete game round

### Medium Priority
- [ ] Add proper error handling
- [ ] Add timeout logic
- [ ] Improve UI/UX
- [ ] Add card visualization
- [ ] Add game state polling

### Low Priority (Post-MVP)
- [ ] VRF integration
- [ ] Multi-player support
- [ ] Tournament mode
- [ ] SPL token support
- [ ] Advanced betting

## 🔧 Development Commands

```bash
# Build
anchor build

# Deploy
anchor deploy

# Test
anchor test

# Frontend
cd app && npm run dev

# Check program
solana program show <PROGRAM_ID>

# View account
solana account <ACCOUNT_ADDRESS>
```

## 🐛 Troubleshooting

### Deployment Issues
- **Insufficient SOL**: `solana airdrop 2`
- **Wrong cluster**: `solana config set --url devnet`
- **Program ID mismatch**: Update all 3 locations

### Frontend Issues
- **Wallet not connecting**: Check browser extension
- **TEE auth fails**: Verify TEE endpoint is accessible
- **Transaction errors**: Check browser console

### Permission Issues
- **Accounts not private**: Ensure delegation is called
- **Access denied**: Check permission members list
- **Commit fails**: Verify magic_program and magic_context accounts

## 📚 Resources

- [MagicBlock PER Docs](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart)
- [Anchor Docs](https://www.anchor-lang.com/docs)
- [Solana Cookbook](https://solanacookbook.com/)

## 🎯 MVP Goal

Get a working 2-player poker game where:
1. Players can create/join games
2. Game state is private (via PER)
3. Players can take actions
4. Game progresses through phases
5. Winner is determined and paid out

Focus on functionality first, polish later!

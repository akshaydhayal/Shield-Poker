# Quick Start Guide - What to Do Next

## ✅ Current Status
- ✅ Program builds successfully
- ✅ Anchor 0.32.1 configured
- ✅ SDK 0.8.0 integrated
- ✅ All instructions implemented
- ✅ Permission & delegation functions added

## 🚀 Next Steps (In Order)

### 1. Deploy to Devnet (5 minutes)

```bash
# Make sure you're on devnet
solana config set --url devnet

# Check you have SOL (need ~2-3 SOL)
solana balance

# If needed, get SOL
solana airdrop 2

# Deploy!
anchor deploy
```

**After deployment**, you'll see a program ID. Update it in:
1. `programs/private-poker/src/lib.rs` - line 5: `declare_id!("YOUR_PROGRAM_ID");`
2. `app/src/config.ts` - `PROGRAM_ID` constant

Then rebuild and redeploy:
```bash
anchor build
anchor deploy
```

### 2. Test Basic Functionality (10 minutes)

```bash
# Run Anchor tests
anchor test

# Or test manually
anchor test --skip-local-validator
```

### 3. Set Up Frontend (5 minutes)

```bash
cd app
npm install
npm run dev
```

Visit `http://localhost:3000` and test:
- ✅ Wallet connection
- ✅ TEE authorization  
- ✅ Game initialization

### 4. Test Full Game Flow (15 minutes)

**In the frontend:**

1. **Player 1**: 
   - Connect wallet
   - Authorize TEE
   - Initialize game (Game ID: 1, Buy-in: 1 SOL)

2. **Player 2** (different wallet/browser):
   - Connect wallet
   - Authorize TEE
   - Join game (Game ID: 1)

3. **Create Permissions** (for privacy):
   ```typescript
   // This should be called after game init
   await pokerClient.createPermission(gameId, { game: { gameId } }, members);
   ```

4. **Delegate to PER**:
   ```typescript
   await pokerClient.delegatePda(gameId, { game: { gameId } }, VALIDATORS.TEE);
   ```

5. **Play**:
   - Set deck seed
   - Deal cards
   - Take actions (bet, call, fold)
   - Advance phases
   - Resolve game

## 📋 Implementation Priority

### Must Have (MVP)
1. ✅ Deploy program
2. ✅ Update program IDs
3. ⏳ Test game initialization
4. ⏳ Test player join
5. ⏳ Set up permissions automatically
6. ⏳ Test one complete game round

### Should Have
- [ ] Add automatic permission creation in `join_game`
- [ ] Add automatic delegation after both players join
- [ ] Improve error messages
- [ ] Add timeout handling

### Nice to Have
- [ ] VRF integration
- [ ] Better UI/UX
- [ ] Card visualization
- [ ] Game history

## 🔧 Key Commands

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
```

## 🎯 Your Immediate Action Items

1. **Deploy the program** (run `anchor deploy`)
2. **Update program IDs** in the 2 files mentioned above
3. **Rebuild and redeploy**
4. **Test frontend** - connect wallet and try initializing a game
5. **Test TEE authorization** - make sure you can get auth token

## 💡 Pro Tips

- **Test with 2 wallets**: Use Phantom and Solflare, or 2 different Phantom profiles
- **Check Solana Explorer**: After each transaction, check it on explorer.solana.com
- **Use devnet**: Everything is free on devnet, perfect for testing
- **Check browser console**: Frontend errors will show there
- **Start simple**: Get basic game flow working before adding VRF/complex features

## 🐛 If Something Breaks

1. **Check program ID** matches in all 3 places
2. **Check wallet has SOL**: `solana balance`
3. **Check you're on devnet**: `solana config get`
4. **Check browser console** for frontend errors
5. **Check transaction on explorer** to see what failed

## 📚 Helpful Resources

- MagicBlock Docs: https://docs.magicblock.gg
- Anchor Docs: https://www.anchor-lang.com/docs
- Solana Cookbook: https://solanacookbook.com/

---

**Ready? Start with step 1: `anchor deploy`** 🚀

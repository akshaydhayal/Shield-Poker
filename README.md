# Private Poker on Solana with MagicBlock PER

A privacy-preserving poker game built on Solana using MagicBlock's Private Ephemeral Rollups (PER) for confidential game state and real-time execution.

## 🎯 Project Overview

This is an MVP implementation of a 2-player Texas Hold'em poker game that runs privately on MagicBlock's TEE (Trusted Execution Environment). The game state, including player hands, is kept confidential through MagicBlock's PER technology.

## 🏗️ Architecture

### On-Chain Program (Anchor)
- **Game State**: Tracks game phases, pot, players, board cards
- **Player State**: Stores each player's committed chips, hand (encrypted), fold status
- **Game Vault**: Escrows SOL for the game
- **MagicBlock Integration**: Permission hooks and delegation hooks for privacy

### Frontend (Next.js)
- Wallet connection (Phantom, Solflare)
- MagicBlock TEE authorization
- Game UI for player actions
- Real-time state polling

## 🚀 Getting Started

### Prerequisites

- Solana CLI 2.3.13+
- Rust 1.85.0+
- Anchor 0.32.1+
- Node.js 24.10.0+

### Installation

1. **Install Anchor**:
   ```bash
   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
   avm install 0.32.1
   avm use 0.32.1
   ```

2. **Build the program**:
   ```bash
   anchor build
   ```

3. **Deploy to devnet**:
   ```bash
   anchor deploy
   ```

4. **Install frontend dependencies**:
   ```bash
   cd app
   npm install
   ```

5. **Run the frontend**:
   ```bash
   npm run dev
   ```

## 🎮 Game Flow

1. **Initialize Game**: Player 1 creates a game with a buy-in amount
2. **Join Game**: Player 2 joins the game
3. **Set Deck Seed**: Deck seed is set (from VRF or commit-reveal)
4. **Deal Cards**: Cards are dealt to players (encrypted via PER)
5. **Player Actions**: Players can bet, call, fold, or check
6. **Advance Phase**: Game progresses through PreFlop → Flop → Turn → River → Showdown
7. **Resolve Game**: Winner is determined and pot is distributed

## 🔒 Privacy Features

- **Private State**: Player hands are encrypted and only visible to authorized players
- **TEE Execution**: Game logic runs in MagicBlock's Trusted Execution Environment
- **Access Control**: Fine-grained permissions via MagicBlock's Permission Program
- **Real-time Privacy**: State changes are processed privately on PER

## 🛠️ MagicBlock Integration

### Permission Program
- Program ID: `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`
- Manages access control for game accounts

### Delegation Program
- Program ID: `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`
- Delegates accounts to PER validators

### TEE Endpoint
- URL: `https://tee.magicblock.app`
- Requires authorization token for access

### Validators
- TEE: `FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA`
- Asia: `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`
- EU: `MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e`
- US: `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd`

## 📝 MVP Scope

- ✅ 2-player heads-up poker
- ✅ Fixed blinds
- ✅ Bet/Call/Fold/Check actions
- ✅ Game phases (PreFlop → Flop → Turn → River → Showdown)
- ✅ MagicBlock PER integration
- ✅ Private state via TEE
- ⏳ VRF integration (planned)
- ⏳ Multi-player tables (future)
- ⏳ Tournament mode (future)

## 🔧 Development

### Program Structure
```
programs/private-poker/
├── src/
│   └── lib.rs          # Main program logic
└── Cargo.toml

app/
├── src/
│   ├── app/            # Next.js pages
│   ├── lib/            # Client libraries
│   └── config.ts       # Configuration
└── package.json
```

### Key Instructions

- `initialize_game`: Create a new game
- `join_game`: Second player joins
- `set_deck_seed`: Set deck seed (from VRF)
- `deal_cards`: Deal cards to players
- `player_action`: Execute player action
- `advance_phase`: Move to next game phase
- `resolve_game`: Determine winner and payout
- `create_permission`: Create permission account
- `delegate_pda`: Delegate account to PER

## 📚 Resources

- [MagicBlock PER Documentation](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart)
- [Anchor Documentation](https://www.anchor-lang.com/docs)
- [Solana Documentation](https://docs.solana.com/)

## 🏆 Hackathon Submission

This project is submitted for the **Privacy Hack 2026** hackathon in the **MagicBlock Track**:
- **Track**: Real-time Privacy with MagicBlock
- **Prize**: $2,500 (Best Private App), $1,500 (Second Place), $1,000 (Third Place)

## 📄 License

MIT

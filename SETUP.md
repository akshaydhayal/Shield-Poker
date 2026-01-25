# Setup Guide

## Prerequisites

1. **Solana CLI** (2.3.13+)
   ```bash
   sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
   ```

2. **Rust** (1.85.0+)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. **Anchor** (0.31.1)
   
   **If you get GLIBC errors, build from source:**
   ```bash
   # Quick build script (recommended)
   cd /home/akshay/wslProjects/solana-privacy
   ./build-anchor.sh
   
   # Then use the version
   avm use 0.31.1
   ```
   
   **Or manually build from source:**
   ```bash
   # Install avm
   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
   
   # Build Anchor 0.31.1 from source
   git clone https://github.com/coral-xyz/anchor.git /tmp/anchor
   cd /tmp/anchor
   git checkout v0.31.1
   cargo build --release
   mkdir -p ~/.avm/bin
   cp target/release/anchor ~/.avm/bin/anchor-0.31.1
   chmod +x ~/.avm/bin/anchor-0.31.1
   
   # Use the version
   avm use 0.31.1
   ```
   
   **If GLIBC 2.39+ is available, use pre-built:**
   ```bash
   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
   avm install 0.31.1
   avm use 0.31.1
   ```

4. **Node.js** (24.10.0+)
   ```bash
   # Using nvm
   nvm install 24.10.0
   nvm use 24.10.0
   ```

## Build and Deploy

### 1. Build the Program

```bash
# From project root
anchor build
```

This will:
- Compile the Rust program
- Generate the IDL (Interface Definition Language)
- Create the program binary

### 2. Configure Solana CLI

```bash
# Set to devnet
solana config set --url devnet

# Generate a keypair if you don't have one
solana-keygen new

# Airdrop SOL for testing
solana airdrop 2
```

### 3. Deploy the Program

```bash
anchor deploy
```

Note the program ID from the output. Update `Anchor.toml` and `app/src/config.ts` with the deployed program ID.

### 4. Update Program ID

After deployment, update:
- `Anchor.toml` - `[programs.devnet]` section
- `app/src/config.ts` - `PROGRAM_ID` constant
- `programs/private-poker/src/lib.rs` - `declare_id!()` macro

Then rebuild:
```bash
anchor build
anchor deploy
```

## Frontend Setup

### 1. Install Dependencies

```bash
cd app
npm install
```

### 2. Environment Variables

Create `.env.local`:

```env
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=<your-program-id>
```

### 3. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:3000`

## Testing

### Manual Testing Flow

1. **Connect Wallet**: Use Phantom or Solflare wallet
2. **Authorize TEE**: Click "Authorize TEE Access" to get authorization token
3. **Initialize Game**: Player 1 creates a game with buy-in
4. **Join Game**: Player 2 joins the game
5. **Set Deck Seed**: Set deck seed (from VRF or manual)
6. **Deal Cards**: Deal cards to players
7. **Play**: Execute actions (bet, call, fold, check)
8. **Advance Phases**: Move through game phases
9. **Resolve**: Determine winner and payout

### Using MagicBlock TEE

1. After authorizing, transactions will use the TEE endpoint
2. Game state is kept private in the TEE
3. Only authorized players can view their hands
4. Board cards are revealed at appropriate phases

## Troubleshooting

### Build Errors

- **Rust version**: Ensure Rust 1.85.0+
- **Anchor version**: Use `avm list` to check, `avm use 0.31.1` to switch
- **GLIBC errors**: Build Anchor from source using `./build-anchor.sh` (see `BUILD_ANCHOR.md`)
- **Dependencies**: Run `cargo update` in `programs/private-poker/`

### Deployment Issues

- **Insufficient SOL**: Airdrop more SOL with `solana airdrop 2`
- **Program ID mismatch**: Ensure program ID matches in all files
- **Network issues**: Check `solana config get` for correct cluster

### Frontend Issues

- **Wallet not connecting**: Check browser extension is installed
- **TEE authorization fails**: Verify TEE endpoint is accessible
- **Transaction errors**: Check browser console and Solana explorer

## Next Steps

1. Integrate MagicBlock VRF for card shuffling (see `VRF_INTEGRATION.md`)
2. Add permission creation and delegation in game initialization
3. Implement proper winner determination logic
4. Add UI for displaying cards and game state
5. Add timeout handling for player actions

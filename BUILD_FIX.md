# Build Fix Summary

## Current Issue

The `ephemeral-rollups-sdk` version 0.8.0 is not compatible with Anchor 0.31.1 or 0.32.1 due to Solana type mismatches.

## Solution

You have two options:

### Option 1: Use Anchor 0.30.x (Recommended for now)

The ephemeral-rollups-sdk 0.8.0 was likely tested with Anchor 0.30.x. Try:

```bash
# Build Anchor 0.30.0 from source
cd /tmp
git clone https://github.com/coral-xyz/anchor.git
cd anchor
git checkout v0.30.0
cargo build --release
mkdir -p ~/.avm/bin
cp target/release/anchor ~/.avm/bin/anchor-0.30.0
chmod +x ~/.avm/bin/anchor-0.30.0

# Update project
cd ~/wslProjects/solana-privacy
sed -i 's/0.31.1/0.30.0/g' Anchor.toml
sed -i 's/0.31.1/0.30.0/g' programs/private-poker/Cargo.toml
sed -i 's/"0.31.1"/"0.30.0"/g' package.json

avm use 0.30.0
anchor build
```

### Option 2: Wait for SDK Update

Check MagicBlock's GitHub for a newer SDK version that supports Anchor 0.31.1+:
- https://github.com/magicblock-labs/ephemeral-rollups-sdk

### Option 3: Use SDK v2 Attributes

The SDK has v2 attributes that might be more compatible:
- `ephemeral-rollups-sdk-attribute-ephemeral-v2`
- `ephemeral-rollups-sdk-attribute-delegate-v2`
- `ephemeral-rollups-sdk-attribute-commit-v2`

Try updating to use these instead.

## Quick Test

Try this to see what Solana versions are being used:

```bash
cd ~/wslProjects/solana-privacy
cargo tree -p anchor-lang | grep solana-program
cargo tree -p ephemeral-rollups-sdk | grep solana-program
```

If they're different versions, that's the issue.

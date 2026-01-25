# Building Anchor from Source (WSL/Linux)

If you're getting GLIBC version errors when using pre-built Anchor binaries, build from source.

## Quick Fix

Run these commands to build Anchor 0.31.1 from source:

```bash
# Install dependencies
sudo apt-get update
sudo apt-get install -y pkg-config libssl-dev build-essential

# Install avm (Anchor Version Manager)
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

# Clone Anchor repository
cd /tmp
git clone https://github.com/coral-xyz/anchor.git
cd anchor

# Checkout version 0.31.1
git checkout v0.31.1

# Build from source
cargo build --release

# Create avm bin directory if it doesn't exist
mkdir -p ~/.avm/bin

# Copy the built binary
cp target/release/anchor ~/.avm/bin/anchor-0.31.1
chmod +x ~/.avm/bin/anchor-0.31.1

# Create symlink for avm
ln -sf ~/.avm/bin/anchor-0.31.1 ~/.avm/bin/anchor

# Verify installation
~/.avm/bin/anchor-0.31.1 --version

# Use the version
cd ~/.avm
avm use 0.31.1
```

## Alternative: Use Docker

If building from source doesn't work, you can use Docker:

```bash
# Create a Dockerfile
cat > Dockerfile << EOF
FROM rust:1.75

RUN cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
RUN avm install 0.31.1
RUN avm use 0.31.1

WORKDIR /workspace
EOF

# Build and run
docker build -t anchor-build .
docker run -it -v $(pwd):/workspace anchor-build bash
```

## Verify Installation

After building, verify it works:

```bash
anchor --version
# Should show: anchor-cli 0.31.1
```

Then try building your project:

```bash
cd /home/akshay/wslProjects/solana-privacy
anchor build
```

## Troubleshooting

### Build fails with "cannot find -lssl"
```bash
sudo apt-get install libssl-dev
```

### Build fails with "linker errors
```bash
sudo apt-get install build-essential
```

### Still getting GLIBC errors
Make sure you're using the built binary:
```bash
which anchor
# Should point to ~/.avm/bin/anchor-0.31.1
```

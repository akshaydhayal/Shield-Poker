#!/bin/bash
set -e

echo "Building Anchor 0.31.1 from source..."

# Install dependencies if needed
echo "Checking dependencies..."
if ! command -v cargo &> /dev/null; then
    echo "Error: Rust/Cargo not found. Please install Rust first."
    exit 1
fi

# Install avm if not already installed
if ! command -v avm &> /dev/null; then
    echo "Installing avm..."
    cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
fi

# Create temp directory
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

echo "Cloning Anchor repository..."
git clone https://github.com/coral-xyz/anchor.git
cd anchor

echo "Checking out version 0.31.1..."
git checkout v0.31.1

echo "Building Anchor from source (this may take a while)..."
cargo build --release

echo "Installing built binary..."
mkdir -p ~/.avm/bin
cp target/release/anchor ~/.avm/bin/anchor-0.31.1
chmod +x ~/.avm/bin/anchor-0.31.1

# Create symlink
ln -sf ~/.avm/bin/anchor-0.31.1 ~/.avm/bin/anchor 2>/dev/null || true

# Cleanup
cd ~
rm -rf "$TEMP_DIR"

echo ""
echo "✓ Anchor 0.31.1 built and installed successfully!"
echo ""
echo "Verify installation:"
echo "  ~/.avm/bin/anchor-0.31.1 --version"
echo ""
echo "To use this version:"
echo "  avm use 0.31.1"
echo ""

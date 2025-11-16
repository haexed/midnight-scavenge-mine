#!/bin/bash

set -e

echo ""
echo "⛏️  Midnight Scavenger Miner - Setup Script"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check Node.js
echo -e "${CYAN}Checking dependencies...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js not found${NC}"
    echo "Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js 18+ required (found v$NODE_VERSION)${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js $(node --version)${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ npm $(npm --version)${NC}"

# Check Cargo (optional)
echo ""
echo -e "${CYAN}Checking for Rust toolchain...${NC}"
if command -v cargo &> /dev/null; then
    echo -e "${GREEN}✓ Cargo $(cargo --version | cut -d' ' -f2)${NC}"
    HAS_RUST=true
else
    echo -e "${YELLOW}⚠ Cargo not found (Rust hash engine compilation will be skipped)${NC}"
    HAS_RUST=false
fi

# Install Node dependencies
echo ""
echo -e "${CYAN}Installing Node.js dependencies...${NC}"
npm install
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Check if hash-server binary exists
echo ""
if [ -f "./bin/hash-server" ]; then
    echo -e "${GREEN}✓ Hash engine binary found${NC}"
    NEED_COMPILE=false
else
    echo -e "${YELLOW}⚠ Hash engine binary not found${NC}"
    NEED_COMPILE=true
fi

# Compile Rust hash engine if needed and possible
if [ "$NEED_COMPILE" = true ]; then
    if [ "$HAS_RUST" = true ]; then
        echo ""
        read -p "Compile Rust hash engine from source? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${CYAN}Compiling hash engine (this may take a few minutes)...${NC}"

            # Clone or use existing source
            if [ ! -d "./hashengine-source" ]; then
                echo -e "${CYAN}Cloning hash engine source...${NC}"
                git clone https://github.com/ADA-Markets/midnight_fetcher_bot_public.git hashengine-source
            fi

            cd hashengine-source
            cargo build --release

            # Copy binary
            mkdir -p ../bin
            cp target/release/hash-server ../bin/
            cd ..

            echo -e "${GREEN}✓ Hash engine compiled successfully${NC}"
        else
            echo -e "${YELLOW}Skipping compilation. You'll need to provide the hash-server binary manually.${NC}"
        fi
    else
        echo -e "${RED}Cannot compile without Rust toolchain.${NC}"
        echo "Install Rust from https://rustup.rs or provide a pre-compiled binary in ./bin/hash-server"
        exit 1
    fi
fi

# Create necessary directories
echo ""
echo -e "${CYAN}Creating directories...${NC}"
mkdir -p logs
echo -e "${GREEN}✓ Directories created${NC}"

# Copy example configs if needed
echo ""
if [ ! -f "./twitter-config.json" ]; then
    echo -e "${CYAN}Creating twitter-config.example.json template${NC}"
    if [ ! -f "./twitter-config.example.json" ]; then
        cat > twitter-config.example.json <<EOF
{
  "enabled": false,
  "api_key": "YOUR_TWITTER_API_KEY",
  "api_secret": "YOUR_TWITTER_API_SECRET",
  "access_token": "YOUR_ACCESS_TOKEN",
  "access_secret": "YOUR_ACCESS_SECRET",
  "note": "Rename to twitter-config.json and add your Twitter API credentials"
}
EOF
    fi
    echo -e "${GREEN}✓ Twitter config template created${NC}"
fi

# Final instructions
echo ""
echo -e "${GREEN}=========================================="
echo "Setup complete! 🎉"
echo "==========================================${NC}"
echo ""
echo "Next steps:"
echo ""
echo "1. Register your addresses:"
echo -e "   ${CYAN}python3 register-all-addresses.py${NC}"
echo ""
echo "2. Start mining:"
echo -e "   ${CYAN}node beast-miner.js${NC}      # High performance (4 parallel batches)"
echo -e "   ${CYAN}node parallel-miner.js${NC}   # Gentle mode (2 parallel batches)"
echo ""
echo -e "${YELLOW}Note: Hash engine must be running on port 3001${NC}"
echo "The miners will start it automatically if needed."
echo ""
echo -e "${GREEN}Happy mining! ⛏️${NC}"
echo ""

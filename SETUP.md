# Setup Guide

Quick setup guide for Midnight Scavenger Mine CLI miners.

> **Recommended:** Use [Paddy & Paul's dashboard](https://github.com/ADA-Markets/midnight_fetcher_bot_public) for a full-featured mining experience with web UI. Our miners are for advanced CLI users on Linux only.

## Requirements

- **Linux only** (modern Debian-based distros)
- **Node.js** v18+
- **Rust** 1.70+ (for building hash-server)
- **Python 3** (for address registration)

## Quick Start

### 1. Install Dependencies

```bash
# Node.js (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Python dependencies
pip3 install pycardano requests cbor2

# Project dependencies
npm install
```

### 2. Build Hash Server

The hash-server binary must be built from source (we don't commit binaries for security).

```bash
# Clone their repository
git clone https://github.com/ADA-Markets/midnight_fetcher_bot_public hashengine-build
cd hashengine-build

# Build hash-server binary
cargo build --release --bin hash-server

# Copy to bin/
cp target/release/hash-server ../bin/
cd ..

# Verify it works
./bin/hash-server
# Should see: "listening on 127.0.0.1:9001"
# Press Ctrl+C to stop
```

**For detailed security info and verification steps, see:** [bin/README.md](bin/README.md)

### 3. Register Addresses

```bash
# Register addresses with your seed phrase
python3 register-all-addresses.py
```

This will:
- Prompt for your seed phrase (held in memory only, never written to disk)
- Derive multiple addresses
- Register them with the Midnight API
- Save to `registrations.json`

### 4. Start Mining

```bash
# High performance (100% CPU)
node beast-miner.js

# OR gentle mode (~15% CPU)
node parallel-miner.js
```

## Monitoring

```bash
# View logs
tail -f logs/beast-miner.log
tail -f logs/parallel-miner.log

# Check receipts
node receipts-tracker.js

# Check system status
./status.sh
```

## Troubleshooting

### Hash server not found
- Make sure you built it: `cargo build --release --bin hash-server`
- Check it exists: `ls -la bin/hash-server`
- Make it executable: `chmod +x bin/hash-server`

### "Cannot find module"
- Run `npm install` to install dependencies

### "ECONNREFUSED" or network errors
- Check hash-server is running: `ps aux | grep hash-server`
- Miners start it automatically, but you can test manually: `./bin/hash-server`

### No registrations.json
- Run `python3 register-all-addresses.py` first
- Make sure you have Python dependencies: `pip3 install pycardano requests cbor2`

### Low hash rate
- Ensure CPU isn't thermal throttling: `sensors` (install with `sudo apt install lm-sensors`)
- Check CPU governor: `cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor`
- Should be "performance" not "powersave"

## Additional Tools

```bash
# Generate new wallets (optional, not needed for standard flow)
node generate-wallets.js

# Recover missed submissions from web miner exports
node recover-missed-submissions.js

# Consolidate rewards across addresses
python3 consolidate-rewards.py
```

## Performance Optimization

**For maximum hash rate:**
- Set CPU governor to performance: `sudo cpupower frequency-set -g performance`
- Disable CPU sleep states in BIOS
- Ensure adequate cooling (keep under 80°C)
- Use `beast-miner.js` for 100% CPU utilization

**For background mining:**
- Use `parallel-miner.js` (~15% CPU)
- Let it run continuously for all challenges

---

**Questions?** Check the [README.md](README.md) or see [Paddy & Paul's documentation](https://github.com/ADA-Markets/midnight_fetcher_bot_public).

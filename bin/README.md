# Hash Server Binary

This directory should contain the `hash-server` binary - a Rust-based AshMaize hash engine.

## Security Note

**⚠️ We do not commit compiled binaries to the repository for security reasons.**

### Why No Binary?

Binaries are opaque - you can't verify what they do without reverse engineering. For security and trust:
- **Build from source** ensures you know exactly what code is running
- **Verify checksums** against your own builds
- **Audit the source code** before compiling

### Our Verification Process

This project was verified on **Nov 13, 2025**:
1. Cloned official source: https://github.com/ADA-Markets/midnight_fetcher_bot_public
2. Built from source with `cargo build --release --bin hash-server`
3. Audited source code - hash engine only, no network calls or hardcoded addresses
4. Verified it runs correctly (listens on 127.0.0.1:9001, 32 workers, rayon thread pool)
5. ✅ **All checks passed** - source is clean

**Build date:** Latest commit includes performance improvements from Nov 7, 2025
**Checksum (our build):** `4ee6d71de43189a05028978058b2bab2b7d907031b258def9834f21209f576c6`

Note: Checksums vary by Rust version, build environment, and commit version. Always build from latest source.

### Important: No Dev Fee in Hash Server

The official ADA-Markets repository includes a **web dashboard with a 1-in-17 dev fee** in the orchestration layer.

**We do NOT use their orchestration.** This project uses:
- ✅ Their `hash-server` binary (clean, audited, just hashes data)
- ✅ Our own miners (`beast-miner.js`, `parallel-miner.js`) with **NO dev fee**
- ✅ Direct submission to Midnight API with **only YOUR addresses**

The hash-server is a pure hash engine with no orchestration, mining logic, or fee mechanisms. Our miners control everything and mine 100% for your addresses in `registrations.json`.

## Building from Source

### Option 1: Clone and Build Official Source

```bash
# Clone the official AshMaize implementation
git clone https://github.com/ADA-Markets/midnight_fetcher_bot_public.git hashengine-source
cd hashengine-source

# Build the hash server
cargo build --release

# Copy binary to bin/
cp target/release/hash-server ../bin/

# Make executable
chmod +x ../bin/hash-server
```

### Option 2: Build from Archive (if available locally)

If you have the source in `archive/hashengine-source/`:

```bash
cd archive/hashengine-source
cargo build --release
cp target/release/hash-server ../../bin/
cd ../..
chmod +x bin/hash-server
```

## Verify Binary

After building or downloading, verify your binary:

```bash
# Check it runs
./bin/hash-server --version

# Check file type
file bin/hash-server
# Expected: ELF 64-bit LSB pie executable, x86-64

# Generate checksum for your build
sha256sum bin/hash-server
```

## Reference Checksums

**Linux x86_64 build (Nov 6, 2025):**
```
SHA256: a6f3c522f51bde269b96397f9de6af0063e5f25ad0b3330716fa7e669cbf37ac
```

Note: Checksums will vary based on Rust version, build flags, and source version. Always build from the official source when possible.

## What is hash-server?

The hash-server is an Actix-web HTTP server that:
- Listens on port 3001 (default)
- Accepts batch hash requests via POST `/hash-batch`
- Uses 32 Rayon worker threads for parallel hashing
- Implements AshMaize algorithm (Argon2 + Blake2b, ASIC-resistant)
- Processes ~25,000-35,000 hashes per second on high-end CPUs

## Troubleshooting

### "Permission denied"
```bash
chmod +x bin/hash-server
```

### "cannot execute binary file: Exec format error"
Your system architecture doesn't match the binary. Rebuild from source.

### Port 3001 already in use
```bash
# Find process
lsof -i :3001

# Kill it
kill -9 <PID>
```

## Source Attribution

- **Created by:** Paddy ([@PoolShamrock](https://x.com/PoolShamrock)) & Paul ([@cwpaulm](https://x.com/cwpaulm))
- **Repository:** [midnight_fetcher_bot_public](https://github.com/ADA-Markets/midnight_fetcher_bot_public)
- **Algorithm:** AshMaize (ASIC-resistant Proof of Work)
- **License:** MIT

---

**For security, always prefer building from the official source over using precompiled binaries.**

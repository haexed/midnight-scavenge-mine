#!/usr/bin/env node

import * as bip39 from 'bip39';
import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import fs from 'fs';
import crypto from 'crypto';
import chalk from 'chalk';

const WALLETS_FILE = './wallets.json';
const API_BASE = 'https://scavenger.prod.gd.midnighttge.io';

// Derive Cardano address from mnemonic
function deriveAddress(mnemonic, index = 0) {
  // Convert mnemonic to entropy
  const entropy = bip39.mnemonicToEntropy(mnemonic);

  // Create root key from entropy
  const rootKey = CardanoWasm.Bip32PrivateKey.from_bip39_entropy(
    Buffer.from(entropy, 'hex'),
    Buffer.from('') // Empty password
  );

  // Derive account key (m/1852'/1815'/0')
  const accountKey = rootKey
    .derive(harden(1852)) // purpose
    .derive(harden(1815)) // coin_type (ADA)
    .derive(harden(0));   // account

  // Derive address key (m/1852'/1815'/0'/0/index)
  const addressKey = accountKey
    .derive(0)  // external chain
    .derive(index);

  // Get public key
  const publicKey = addressKey.to_public();

  // Build stake key (m/1852'/1815'/0'/2/0)
  const stakeKey = accountKey
    .derive(2)  // staking chain
    .derive(0)
    .to_public();

  // Create base address (mainnet = 1)
  const baseAddr = CardanoWasm.BaseAddress.new(
    1, // mainnet
    CardanoWasm.StakeCredential.from_keyhash(publicKey.to_raw_key().hash()),
    CardanoWasm.StakeCredential.from_keyhash(stakeKey.to_raw_key().hash())
  );

  return {
    address: baseAddr.to_address().to_bech32(),
    privateKey: addressKey.to_bech32(),
    publicKey: publicKey.to_bech32(),
    stakeKey: stakeKey.to_bech32()
  };
}

function harden(num) {
  return 0x80000000 + num;
}

// Sign message for CIP-30 registration
function signMessage(privateKeyBech32, message) {
  const privateKey = CardanoWasm.Bip32PrivateKey.from_bech32(privateKeyBech32);
  const rawKey = privateKey.to_raw_key();

  // Hash the message
  const messageHash = crypto.createHash('sha256').update(message).digest();

  // Sign
  const signature = rawKey.sign(messageHash);

  return signature.to_hex();
}

// Register wallet with Midnight API
async function registerWallet(wallet) {
  // Get registration message from API
  const tcResponse = await fetch(`${API_BASE}/TandC`);
  const tcData = await tcResponse.json();
  const message = tcData.message;

  // Sign the message
  const signature = signMessage(wallet.privateKey, message);

  // Build CIP-30 envelope (simplified - may need adjustment)
  const coseSign1 = {
    signature: signature,
    key: wallet.publicKey
  };

  // Register
  const registerResponse = await fetch(`${API_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: wallet.address,
      signature: Buffer.from(JSON.stringify(coseSign1)).toString('hex'),
      key: wallet.publicKey
    })
  });

  const result = await registerResponse.json();
  return result;
}

async function generateWallets(count) {
  console.log(chalk.cyan.bold(`\n🔑 Generating ${count} Cardano wallets...\n`));

  const wallets = [];

  for (let i = 0; i < count; i++) {
    // Generate random mnemonic (24 words for maximum security)
    const mnemonic = bip39.generateMnemonic(256);

    // Derive first address from this mnemonic
    const wallet = deriveAddress(mnemonic, 0);

    wallets.push({
      id: i + 1,
      mnemonic: mnemonic,
      address: wallet.address,
      privateKey: wallet.privateKey,
      publicKey: wallet.publicKey,
      stakeKey: wallet.stakeKey,
      registered: false
    });

    console.log(chalk.green(`✓ Wallet ${i + 1}/${count}: ${wallet.address.substring(0, 30)}...`));
  }

  // Save to file
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2));
  console.log(chalk.green.bold(`\n✓ Saved ${count} wallets to ${WALLETS_FILE}`));

  // Show warning
  console.log(chalk.yellow.bold('\n⚠️  IMPORTANT SECURITY WARNING:'));
  console.log(chalk.yellow('   - wallets.json contains private keys and mnemonics'));
  console.log(chalk.yellow('   - NEVER commit this file to git'));
  console.log(chalk.yellow('   - Backup this file securely (encrypted)'));
  console.log(chalk.yellow('   - Each wallet needs ~1 ADA for claiming fees\n'));

  // Calculate funding needed
  const fundingNeeded = count * 1; // 1 ADA per wallet
  console.log(chalk.cyan(`💰 Total ADA needed to fund all wallets: ~${fundingNeeded} ADA ($${(fundingNeeded * 0.90).toFixed(2)})`));
  console.log(chalk.cyan(`   Send funds to each address to enable claiming\n`));

  return wallets;
}

async function registerAllWallets() {
  if (!fs.existsSync(WALLETS_FILE)) {
    console.log(chalk.red('Error: wallets.json not found. Run generate first.'));
    return;
  }

  const wallets = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
  console.log(chalk.cyan.bold(`\n📝 Registering ${wallets.length} wallets with Midnight API...\n`));

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];

    if (wallet.registered) {
      console.log(chalk.gray(`○ Wallet ${wallet.id}: Already registered`));
      continue;
    }

    try {
      console.log(chalk.yellow(`⏳ Registering wallet ${wallet.id}...`));
      await registerWallet(wallet);

      wallet.registered = true;
      wallets[i] = wallet;

      console.log(chalk.green(`✓ Wallet ${wallet.id}: Registered successfully`));

      // Save progress
      fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2));

      // Rate limit protection
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(chalk.red(`✗ Wallet ${wallet.id}: Registration failed - ${error.message}`));
    }
  }

  console.log(chalk.green.bold('\n✓ Registration complete!\n'));
}

// CLI
const args = process.argv.slice(2);
const command = args[0];
const count = parseInt(args[1]) || 10;

if (command === 'generate') {
  generateWallets(count);
} else if (command === 'register') {
  registerAllWallets();
} else if (command === 'list') {
  if (!fs.existsSync(WALLETS_FILE)) {
    console.log(chalk.red('No wallets found. Run: node generate-wallets.js generate 100'));
    process.exit(1);
  }

  const wallets = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
  console.log(chalk.cyan.bold(`\n📋 ${wallets.length} wallets:\n`));

  wallets.forEach(w => {
    const status = w.registered ? chalk.green('✓') : chalk.gray('○');
    console.log(`${status} Wallet ${w.id}: ${w.address}`);
  });
  console.log('');

} else {
  console.log(chalk.cyan.bold('\n🔑 Wallet Generator for Midnight Scavenger Mine\n'));
  console.log('Usage:');
  console.log('  node generate-wallets.js generate [count]  - Generate N wallets (default: 10)');
  console.log('  node generate-wallets.js register          - Register all wallets with API');
  console.log('  node generate-wallets.js list              - List all wallets\n');
  console.log('Examples:');
  console.log('  node generate-wallets.js generate 100      - Generate 100 wallets');
  console.log('  node generate-wallets.js generate 10       - Generate 10 wallets');
  console.log('');
}

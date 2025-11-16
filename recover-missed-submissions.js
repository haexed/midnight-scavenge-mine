#!/usr/bin/env node

/**
 * RECOVER MISSED SUBMISSIONS - Beast Mode Edition 🔥
 *
 * Retries failed addresses from previous mining runs
 * Uses beast mode settings (2000 batch size, no timeouts)
 * Automatically uses the latest export file
 */

import chalk from 'chalk';
import fs from 'fs';
import AshMaizeSolver from './src/solver/ashMaizeSolver.js';
import receiptsTracker from './receipts-tracker.js';

const API_BASE = 'https://scavenger.prod.gd.midnighttge.io';

// Auto-detect latest export file from webminer-exports directory
const exportFiles = fs.readdirSync('./webminer-exports').filter(f => f.startsWith('scavenger-mine-export-') && f.endsWith('.json'));
const latestExport = exportFiles.sort().reverse()[0];
console.log(chalk.gray(`Using export file: ${latestExport}\n`));

const exportData = JSON.parse(fs.readFileSync(`./webminer-exports/${latestExport}`, 'utf8'));

// Load all 16 addresses from registrations.json
const registrations = JSON.parse(fs.readFileSync('./registrations.json', 'utf8'));
const addresses = registrations.map(r => r.address);

console.log(chalk.red.bold('🔥 RECOVER MISSED SUBMISSIONS - BEAST MODE 🔥\n'));
console.log(chalk.yellow(`Mining with ${addresses.length} addresses (2000 batch size, no timeouts)\n`));

// Filter for challenges that are still valid (not expired)
const now = new Date();
const validChallenges = exportData.challenge_queue.filter(c => {
  if (c.status !== 'available') return false;
  const deadline = new Date(c.latestSubmission);
  return deadline > now;
});

console.log(chalk.yellow(`Found ${validChallenges.length} valid unmined challenges:\n`));
validChallenges.forEach(c => {
  const deadline = new Date(c.latestSubmission);
  const hoursLeft = ((deadline - now) / 3600000).toFixed(1);
  const cycleInfo = c.challengeNumber ? ` (Challenge ${c.challengeNumber}/${c.challengeTotal})` : '';
  console.log(chalk.gray(`  ${c.challengeId}${cycleInfo} - ${hoursLeft}h remaining`));
});

async function submitSolution(address, challengeId, nonce) {
  const url = `${API_BASE}/solution/${address}/${challengeId}/${nonce}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });

  const result = await response.json();

  // Return full response info for logging
  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    data: result
  };
}

async function mineChallengeForAddress(challengeData, address, addressIndex) {
  const challengeId = challengeData.challengeId;

  // Check if already solved (skip mining entirely to save power!)
  if (receiptsTracker.hasSolved(address, challengeId)) {
    console.log(chalk.gray(`    [${addressIndex + 1}/${addresses.length}] ⏭  ${address.substring(0, 20)}... already solved ${challengeId}`));
    return true;
  }

  const challenge = {
    id: challengeId,
    difficulty: challengeData.difficulty,
    no_pre_mine: challengeData.noPreMine,
    no_pre_mine_hour: challengeData.noPreMineHour,
    latest_submission: challengeData.latestSubmission
  };

  const solver = new AshMaizeSolver({
    numWorkers: 1, // Sequential mining per address
    batchSize: 2000, // BEAST MODE - 2x throughput (same as beast-miner.js)
    address: address
  });

  await solver.initialize();

  const startTime = Date.now();

  // No timeout - let it run as long as needed (difficulty is increasing!)
  const solution = await solver.solve(challenge);
  const elapsed = (Date.now() - startTime) / 1000;

  await solver.shutdown();

  console.log(chalk.green(`    [${addressIndex + 1}/${addresses.length}] ✓ ${address.substring(0, 20)}... solved in ${elapsed.toFixed(2)}s`));

  // Submit
  try {
    const response = await submitSolution(address, challenge.id, solution.nonce);

    // Log full API response
    if (response.ok) {
      console.log(chalk.green(`    [${addressIndex + 1}/${addresses.length}] ✅ HTTP ${response.status}`));
      console.log(chalk.gray(`      ${JSON.stringify(response.data)}`));

      // Record successful solution in tracker
      receiptsTracker.recordSolution(address, challenge.id, solution.nonce, response.data);

      return true;
    } else {
      // "Already exists" is actually GOOD (helps with validation) - don't treat as failure
      const msg = response.data.message || response.statusText;
      if (msg.toLowerCase().includes('already exist')) {
        console.log(chalk.yellow(`    [${addressIndex + 1}/${addresses.length}] ⚠ HTTP ${response.status}: ${msg} (this helps validation!)`));
        console.log(chalk.gray(`      ${JSON.stringify(response.data)}`));

        // Record as solved (even though "already exists") to prevent re-mining
        receiptsTracker.recordSolution(address, challenge.id, solution.nonce, response.data);

        return true; // Count as success
      } else {
        console.log(chalk.red(`    [${addressIndex + 1}/${addresses.length}] ❌ HTTP ${response.status}: ${msg}`));
        console.log(chalk.gray(`      ${JSON.stringify(response.data)}`));
        return false;
      }
    }
  } catch (error) {
    console.log(chalk.red(`    [${addressIndex + 1}/${addresses.length}] ❌ Network error: ${error.message}`));
    return false;
  }
}

async function mineChallenge(challengeData) {
  const cycleInfo = challengeData.challengeNumber ? ` (Challenge ${challengeData.challengeNumber}/${challengeData.challengeTotal})` : '';
  console.log(chalk.cyan.bold(`\n⛏  Mining ${challengeData.challengeId}${cycleInfo} with ${addresses.length} addresses...`));

  let submitted = 0;

  // Mine sequentially for each address
  for (let i = 0; i < addresses.length; i++) {
    try {
      const success = await mineChallengeForAddress(challengeData, addresses[i], i);
      if (success) submitted++;
    } catch (error) {
      console.log(chalk.red(`    [${i + 1}/${addresses.length}] ❌ Failed: ${error.message.substring(0, 50)}`));
    }
  }

  console.log(chalk.green(`  ✅ ${challengeData.challengeId}: ${submitted}/${addresses.length} submitted\n`));
  return submitted;
}

// Mine all valid challenges
(async () => {
  let totalSubmitted = 0;

  for (const challengeData of validChallenges) {
    try {
      const submitted = await mineChallenge(challengeData);
      totalSubmitted += submitted;
    } catch (error) {
      console.log(chalk.red(`\n❌ Failed to mine ${challengeData.challengeId}: ${error.message}`));
    }
  }

  const maxPossible = validChallenges.length * addresses.length;
  console.log(chalk.green.bold(`\n\n✅ Complete! ${totalSubmitted}/${maxPossible} total submissions accepted.`));
  console.log(chalk.gray(`   (${validChallenges.length} challenges × ${addresses.length} addresses)`));
})();

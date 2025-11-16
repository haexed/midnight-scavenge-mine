#!/usr/bin/env node

import chalk from 'chalk';
import fs from 'fs';
import AshMaizeSolver from './src/solver/ashMaizeSolver.js';
import DualLogger from './src/utils/logger.js';
import receiptsTracker from './receipts-tracker.js';

const API_BASE = 'https://scavenger.prod.gd.midnighttge.io';
const logger = new DualLogger('parallel-miner.log');

// Configuration - Quiet Mode (gentleman's setup)
const NUM_PARALLEL_BATCHES = 2;
const ADDRESSES_PER_BATCH = 8;
const TOTAL_ADDRESSES = NUM_PARALLEL_BATCHES * ADDRESSES_PER_BATCH; // 16
const WORKERS_PER_BATCH = 1; // 2 batches × 1 worker = 2 total (ultra quiet!)

logger.raw(chalk.cyan.bold('\n🚀 PARALLEL MULTI-ADDRESS MINER\n'));
logger.log(chalk.yellow(`Mining with ${TOTAL_ADDRESSES} addresses in ${NUM_PARALLEL_BATCHES} parallel batches`));
logger.log(chalk.gray(`Each batch: ${ADDRESSES_PER_BATCH} addresses with ${WORKERS_PER_BATCH} workers\n`));

// Load solved challenges
const SOLVED_FILE = './solved-challenges.json';
const solvedChallenges = new Set();

if (fs.existsSync(SOLVED_FILE)) {
  try {
    const solved = JSON.parse(fs.readFileSync(SOLVED_FILE, 'utf8'));
    solved.forEach(id => solvedChallenges.add(id));
    logger.log(chalk.gray(`Loaded ${solvedChallenges.size} previously solved challenges`));
  } catch (e) {
    logger.log(chalk.yellow('Warning: Could not load solved challenges history'));
  }
}

function saveSolvedChallenges() {
  fs.writeFileSync(SOLVED_FILE, JSON.stringify([...solvedChallenges], null, 2));
}

async function getChallengeInfo() {
  try {
    const response = await fetch(`${API_BASE}/challenge`);

    if (!response.ok) {
      throw new Error(`API returned ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.code !== 'active') {
      return null;
    }

    // Defensive checks on API response structure
    if (!data.challenge) {
      throw new Error(`FATAL: API response missing 'challenge' field. Response: ${JSON.stringify(data).substring(0, 200)}`);
    }

    const c = data.challenge;
    if (!c.challenge_id || !c.difficulty || !c.no_pre_mine) {
      throw new Error(`FATAL: API challenge missing required fields. Challenge: ${JSON.stringify(c)}`);
    }

    // Calculate sequential challenge number across entire campaign
    const sequentialNumber = data.total_challenges ? ((c.day - 1) * 24 + c.challenge_number) : null;

    return {
      challenge: {
        id: c.challenge_id,
        difficulty: c.difficulty,
        no_pre_mine: c.no_pre_mine,
        latest_submission: c.latest_submission,
        no_pre_mine_hour: c.no_pre_mine_hour,
        cycle: sequentialNumber,
        cycleTotal: data.total_challenges || 504,
        day: c.day,
        issued_at: c.issued_at
      },
      next_challenge_starts_at: data.next_challenge_starts_at
    };
  } catch (error) {
    logger.log(chalk.red(`FATAL: getChallengeInfo failed: ${error.message}`));
    if (error.stack) {
      logger.log(chalk.gray(`Stack: ${error.stack}`));
    }
    throw error;
  }
}

async function mineChallenge(challenge, address, batchId) {
  // Defensive checks
  if (!challenge || !challenge.id) {
    throw new Error(`FATAL: mineChallenge called with invalid challenge: ${JSON.stringify(challenge)}`);
  }

  if (!address || !address.startsWith('addr1')) {
    throw new Error(`FATAL: mineChallenge called with invalid address: ${address}`);
  }

  const solver = new AshMaizeSolver({
    numWorkers: WORKERS_PER_BATCH,
    batchSize: 1000, // Increased from 300 for better throughput
    address: address
  });

  await solver.initialize();

  const startTime = Date.now();

  // No timeout - let it run as long as needed (difficulty is increasing!)
  let solution;
  try {
    solution = await solver.solve(challenge);
  } finally {
    await solver.shutdown();
  }

  const elapsed = (Date.now() - startTime) / 1000;

  // Validate solution before returning
  if (!solution || !solution.nonce || !solution.hash) {
    throw new Error(`FATAL: Solver returned invalid solution: ${JSON.stringify(solution)}`);
  }

  if (solution.nonce.length !== 16) {
    throw new Error(`FATAL: Solver returned invalid nonce length: ${solution.nonce} (length: ${solution.nonce.length})`);
  }

  logger.log(chalk.green(`  [Batch ${batchId}] ${address.substring(0, 20)}... solved in ${elapsed.toFixed(2)}s`));

  return {
    address,
    nonce: solution.nonce,
    hash: solution.hash,
    attempts: solution.attempts,
    elapsed
  };
}

async function submitSolution(address, challengeId, nonce) {
  // Defensive checks on inputs
  if (!address || !address.startsWith('addr1')) {
    throw new Error(`FATAL: Invalid address for submission: ${address}`);
  }

  if (!challengeId || typeof challengeId !== 'string') {
    throw new Error(`FATAL: Invalid challengeId for submission: ${challengeId} (type: ${typeof challengeId})`);
  }

  if (!nonce || nonce.length !== 16) {
    throw new Error(`FATAL: Invalid nonce for submission: ${nonce} (length: ${nonce?.length})`);
  }

  const url = `${API_BASE}/solution/${address}/${challengeId}/${nonce}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });

    const result = await response.json();

    // Return full response for better logging
    return {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      data: result
    };
  } catch (error) {
    // Add context to network errors
    if (error.message.includes('fetch failed')) {
      throw new Error(`Network failure submitting to ${API_BASE}: ${error.message}. Address: ${address.substring(0, 20)}..., Challenge: ${challengeId}`);
    }
    throw error;
  }
}

async function submitWithRetry(address, challengeId, nonce, batchId, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await submitSolution(address, challengeId, nonce);

      // Check if submission was successful or "already exists" (which is good!)
      if (response.ok) {
        return response;
      }

      const errorMsg = response.data.message || response.statusText;

      // "Already exists" is actually GOOD - helps with validation
      if (errorMsg.toLowerCase().includes('already exist')) {
        logger.log(chalk.yellow(`  [Batch ${batchId}] ⚠ HTTP ${response.status}: ${errorMsg} (helps validation!)`));
        logger.log(chalk.gray(`    ${JSON.stringify(response.data)}`));
        return response; // Count as success
      }

      // Other API errors - retry
      if (attempt === maxRetries) {
        logger.log(chalk.red(`  [Batch ${batchId}] ❌ HTTP ${response.status} after ${maxRetries} attempts`));
        logger.log(chalk.gray(`    ${JSON.stringify(response.data)}`));
        throw new Error(`HTTP ${response.status}: ${errorMsg}`);
      }

      const delay = attempt * 2000;
      logger.log(chalk.yellow(`  [Batch ${batchId}] ⚠ HTTP ${response.status}: ${errorMsg.substring(0, 30)}... retry in ${delay/1000}s`));
      logger.log(chalk.gray(`    ${JSON.stringify(response.data)}`));
      await new Promise(resolve => setTimeout(resolve, delay));

    } catch (error) {
      const errorMsg = error.message || String(error);

      // Network error - retry
      if (attempt === maxRetries) {
        logger.log(chalk.red(`  [Batch ${batchId}] ❌ Network error after ${maxRetries} attempts: ${errorMsg.substring(0, 40)}`));
        throw error;
      }

      const delay = attempt * 2000;
      logger.log(chalk.yellow(`  [Batch ${batchId}] ⚠ Network error: ${errorMsg.substring(0, 30)}... retry in ${delay/1000}s`));
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function mineBatch(challenge, addresses, batchId) {
  logger.log(chalk.cyan(`\n[Batch ${batchId}] Starting to mine & submit ${addresses.length} addresses...`));

  const results = [];
  let mined = 0;
  let submitted = 0;

  // Mine and submit each address immediately (batches run in parallel)
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];

    // Check if already solved (skip mining entirely to save power!)
    if (receiptsTracker.hasSolved(address, challenge.id)) {
      logger.log(chalk.gray(`  [Batch ${batchId}] ⏭  ${address.substring(0, 20)}... already solved ${challenge.id}`));
      results.push({ address, success: true, submitted: true, skipped: true });
      submitted++;
      continue;
    }

    try {
      // Mine the solution
      const solution = await mineChallenge(challenge, address, batchId);
      mined++;

      // Submit immediately with retry logic
      try {
        const submitResponse = await submitWithRetry(solution.address, challenge.id, solution.nonce, batchId);
        logger.log(chalk.green(`  [Batch ${batchId}] ✓ ${solution.address.substring(0, 20)}... (${solution.elapsed.toFixed(2)}s)`));
        logger.log(chalk.gray(`    HTTP ${submitResponse.status}: ${JSON.stringify(submitResponse.data)}`));

        // Record successful solution in tracker
        receiptsTracker.recordSolution(solution.address, challenge.id, solution.nonce, submitResponse.data);

        results.push({ ...solution, success: true, submitted: true });
        submitted++;
      } catch (submitError) {
        const errMsg = (submitError.message || String(submitError)).substring(0, 40);
        logger.log(chalk.yellow(`  [Batch ${batchId}] ⚠ Submit failed: ${errMsg}...`));
        results.push({ ...solution, success: true, submitted: false, submitError: submitError.message });
      }

      // Small delay between submissions
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      const errMsg = (error.message || String(error)).substring(0, 40);
      logger.log(chalk.red(`  [Batch ${batchId}] ❌ Mine failed ${address.substring(0, 15)}...: ${errMsg}`));
      results.push({ address, success: false, submitted: false, error: error.message });
    }
  }

  logger.log(chalk.green(`[Batch ${batchId}] Completed: ${mined} mined, ${submitted} submitted`));

  return results;
}

async function submitBatch(solutions, challengeId, batchId) {
  logger.log(chalk.yellow(`\n[Batch ${batchId}] Submitting ${solutions.length} solutions...`));

  const results = [];

  for (const solution of solutions) {
    if (!solution.success) {
      results.push({ ...solution, submitted: false });
      continue;
    }

    try {
      const response = await submitSolution(solution.address, challengeId, solution.nonce);

      if (response.ok) {
        logger.log(chalk.green(`  [Batch ${batchId}] ✓ ${solution.address.substring(0, 20)}... HTTP ${response.status}`));
        results.push({ ...solution, submitted: true });
      } else {
        const errMsg = response.data.message || response.statusText;
        // "Already exists" is good - helps validation
        if (errMsg.toLowerCase().includes('already exist')) {
          logger.log(chalk.yellow(`  [Batch ${batchId}] ⚠ ${solution.address.substring(0, 15)}... HTTP ${response.status}: ${errMsg.substring(0, 30)} (validation!)`));
          results.push({ ...solution, submitted: true }); // Count as success
        } else {
          logger.log(chalk.red(`  [Batch ${batchId}] ✗ ${solution.address.substring(0, 15)}... HTTP ${response.status}: ${errMsg.substring(0, 30)}`));
          results.push({ ...solution, submitted: false, submitError: errMsg });
        }
      }
    } catch (error) {
      const errMsg = (error.message || String(error)).substring(0, 35);
      logger.log(chalk.red(`  [Batch ${batchId}] ✗ ${solution.address.substring(0, 15)}... Network error: ${errMsg}`));
      results.push({ ...solution, submitted: false, submitError: error.message });
    }

    // Small delay between submissions
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const successful = results.filter(r => r.submitted).length;
  logger.log(chalk.green(`[Batch ${batchId}] Submitted ${successful}/${solutions.length} successfully`));

  return results;
}

function formatTimeUntil(targetDate) {
  const now = new Date();
  const ms = targetDate - now;

  if (ms < 0) return 'NOW';

  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

async function reliableSleep(ms) {
  const CHUNK_SIZE = 60000;
  let remaining = ms;

  while (remaining > 0) {
    const sleepTime = Math.min(remaining, CHUNK_SIZE);
    await new Promise(resolve => setTimeout(resolve, sleepTime));
    remaining -= sleepTime;
  }
}

async function parallelMiningLoop() {
  // Load registrations with defensive checks
  if (!fs.existsSync('./registrations.json')) {
    logger.log(chalk.red('FATAL: registrations.json not found in current directory'));
    logger.log(chalk.red(`Current directory: ${process.cwd()}`));
    process.exit(1);
  }

  let registrations;
  try {
    const fileContent = fs.readFileSync('./registrations.json', 'utf8');
    registrations = JSON.parse(fileContent);
  } catch (error) {
    logger.log(chalk.red(`FATAL: Failed to parse registrations.json: ${error.message}`));
    logger.log(chalk.red(`Stack: ${error.stack}`));
    process.exit(1);
  }

  // Validate registrations structure
  if (!Array.isArray(registrations)) {
    logger.log(chalk.red(`FATAL: registrations.json must contain an array, got: ${typeof registrations}`));
    process.exit(1);
  }

  if (registrations.length === 0) {
    logger.log(chalk.red('FATAL: registrations.json is empty - no addresses to mine with'));
    process.exit(1);
  }

  if (registrations.length < TOTAL_ADDRESSES) {
    logger.log(chalk.yellow(`Warning: Only ${registrations.length} addresses available, need ${TOTAL_ADDRESSES}`));
    logger.log(chalk.yellow(`Will use ${registrations.length} addresses instead\n`));
  }

  const addresses = registrations.slice(0, TOTAL_ADDRESSES).map(r => r.address);

  // Validate all addresses
  for (let i = 0; i < addresses.length; i++) {
    if (!addresses[i] || !addresses[i].startsWith('addr1')) {
      logger.log(chalk.red(`FATAL: Invalid address at index ${i}: ${addresses[i]}`));
      logger.log(chalk.red(`Registration entry: ${JSON.stringify(registrations[i])}`));
      process.exit(1);
    }
  }

  // Split into batches
  const batches = [];
  for (let i = 0; i < NUM_PARALLEL_BATCHES; i++) {
    const start = i * ADDRESSES_PER_BATCH;
    const end = Math.min(start + ADDRESSES_PER_BATCH, addresses.length);
    const batch = addresses.slice(start, end);

    if (batch.length === 0) {
      logger.log(chalk.red(`FATAL: Batch ${i + 1} is empty! Start: ${start}, End: ${end}, Total addresses: ${addresses.length}`));
      process.exit(1);
    }

    batches.push(batch);
  }

  logger.log(chalk.green(`Loaded ${addresses.length} addresses split into ${batches.length} batches`));
  batches.forEach((batch, i) => {
    logger.log(chalk.gray(`  Batch ${i + 1}: ${batch.length} addresses`));
  });
  logger.raw(chalk.white('────────────────────────────────────────────────'));
  logger.log(chalk.white('Starting parallel mining loop...'));
  logger.log(chalk.white('Press Ctrl+C to stop'));
  logger.raw(chalk.white('────────────────────────────────────────────────\n'));

  let currentChallengeId = null;

  while (true) {
    try {
      // Get current challenge info
      let info = await getChallengeInfo();

      if (!info) {
        logger.log(chalk.red('No active mining period'));
        await new Promise(resolve => setTimeout(resolve, 300000));
        continue;
      }

      let { challenge, next_challenge_starts_at } = info;

      // If already solved, wait and poll for new challenge FIRST
      if (solvedChallenges.has(challenge.id)) {
        currentChallengeId = challenge.id;
        logger.log(chalk.gray(`Current challenge ${challenge.id} already solved`));

        const nextChallengeDate = new Date(next_challenge_starts_at);
        const pollTime = new Date(nextChallengeDate.getTime() - 5000);
        const waitMs = pollTime - new Date();

        if (waitMs > 0) {
          logger.log(chalk.gray(`Next challenge at: ${next_challenge_starts_at}`));
          logger.log(chalk.gray(`Sleeping until ${pollTime.toISOString()} (${formatTimeUntil(pollTime)})\n`));
          await reliableSleep(waitMs);
        }

        // Poll aggressively at first (API is slow to update), then slow down
        logger.log(chalk.yellow.bold('🏁 POLLING MODE - Checking for new challenge...'));
        let foundNew = false;
        let pollCount = 0;
        const pollingStartTime = Date.now();

        while (!foundNew) {
          pollCount++;

          try {
            const checkInfo = await getChallengeInfo();
            if (checkInfo && checkInfo.challenge.id !== currentChallengeId) {
              logger.log(chalk.green.bold(`\n🎯 NEW CHALLENGE DETECTED: ${checkInfo.challenge.id}`));
              info = checkInfo; // Update to use new challenge info
              challenge = checkInfo.challenge;
              next_challenge_starts_at = checkInfo.next_challenge_starts_at;
              foundNew = true;
            } else {
              // Dynamic polling: 10s for first 5 minutes, then 30s
              const elapsed = Date.now() - pollingStartTime;
              const pollInterval = elapsed < 300000 ? 10000 : 30000; // 5 min threshold
              const intervalSec = pollInterval / 1000;

              if (pollCount <= 3 || pollCount % 3 === 1) { // Log first 3, then every 3rd
                logger.log(chalk.gray(`[Poll ${pollCount}] Still ${currentChallengeId || 'unknown'}, rechecking in ${intervalSec}s...`));
              }

              if (!foundNew) {
                await new Promise(resolve => setTimeout(resolve, pollInterval));
              }
            }
          } catch (pollError) {
            logger.log(chalk.yellow(`[Poll ${pollCount}] API error: ${pollError.message}, retrying in 10s...`));
            if (!foundNew) {
              await new Promise(resolve => setTimeout(resolve, 10000));
            }
          }
        }
      }

      // Now we have a new unsolved challenge - mine it
      if (!solvedChallenges.has(challenge.id)) {
        const cycleInfo = challenge.cycle ? ` (Challenge ${challenge.cycle}/${challenge.cycleTotal})` : '';
        logger.log(chalk.cyan.bold(`\n🆕 New challenge detected: ${challenge.id}${cycleInfo}`));
        logger.log(chalk.cyan(`  Issued at: ${challenge.issued_at}`));
        logger.log(chalk.cyan(`  Day: ${challenge.day}/21`));
        logger.log(chalk.cyan(`  Difficulty: ${challenge.difficulty}`));

        currentChallengeId = challenge.id;

        // Mine all batches in parallel (with stagger to avoid init race condition)
        logger.log(chalk.yellow(`\n⚡ Starting parallel mining for ${addresses.length} addresses...`));
        const miningStart = Date.now();

        const batchPromises = batches.map(async (batch, i) => {
          // Stagger batch starts by 500ms to avoid hash-server init race
          await new Promise(resolve => setTimeout(resolve, i * 500));
          return mineBatch(challenge, batch, i + 1);
        });

        const allResults = await Promise.all(batchPromises);

        // Validate batch results structure
        if (!Array.isArray(allResults) || allResults.length !== batches.length) {
          throw new Error(`FATAL: Expected ${batches.length} batch results, got ${allResults?.length}. Results: ${JSON.stringify(allResults).substring(0, 200)}`);
        }

        const flatResults = allResults.flat();

        // Invariant check: we should have attempted to mine all addresses
        if (flatResults.length !== addresses.length) {
          logger.log(chalk.yellow(`WARNING: Expected ${addresses.length} results, got ${flatResults.length}. Some addresses may have failed.`));
          logger.log(chalk.yellow(`Results summary: ${JSON.stringify(flatResults.map(r => ({ addr: r.address?.substring(0, 15), success: r.success, submitted: r.submitted })))}`));
        }

        const totalTime = ((Date.now() - miningStart) / 1000).toFixed(2);
        const mined = flatResults.filter(r => r.success).length;
        const submitted = flatResults.filter(r => r.submitted).length;

        // Report results
        if (submitted === 0) {
          logger.log(chalk.red.bold(`\n❌ 0/${addresses.length} SUBMISSIONS - ALL FAILED!`));
          logger.log(chalk.yellow(`   Will retry this challenge on next cycle`));
        } else {
          logger.log(chalk.green.bold(`\n✅ ${submitted}/${addresses.length} SUBMISSIONS ACCEPTED!`));
          logger.log(chalk.cyan(`   💰 Earned ${submitted}x rewards!`));

          // Mark as solved only AFTER successful submissions
          // This ensures restart will resume if we crash mid-challenge
          solvedChallenges.add(challenge.id);
          saveSolvedChallenges();
        }

        logger.log(chalk.gray(`   Total time: ${totalTime}s (mine + submit)`));
        logger.log(chalk.gray(`   Mined: ${mined}, Submitted: ${submitted}`));

        // Challenge complete - loop back to top to check for next challenge
      }

    } catch (error) {
      // Fail loud with full diagnostic context
      logger.log(chalk.red('\n❌ FATAL ERROR in mining loop:'));
      logger.log(chalk.red(`  Message: ${error.message}`));

      if (error.stack) {
        logger.log(chalk.gray(`  Stack trace:\n${error.stack}`));
      }

      // Dump state for debugging
      logger.log(chalk.yellow('\n  System state at error:'));
      logger.log(chalk.yellow(`    Current challenge: ${currentChallengeId || 'none'}`));
      logger.log(chalk.yellow(`    Solved challenges: ${solvedChallenges.size}`));
      logger.log(chalk.yellow(`    Total addresses: ${addresses.length}`));
      logger.log(chalk.yellow(`    Batches: ${batches.length}`));

      logger.log(chalk.yellow(`\nRetrying in 60s...\n`));
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.raw(chalk.yellow('\n\n⚠️  Shutting down...'));
  logger.log(chalk.green(`✓ Mined ${solvedChallenges.size} challenges this session\n`));
  process.exit(0);
});

parallelMiningLoop();

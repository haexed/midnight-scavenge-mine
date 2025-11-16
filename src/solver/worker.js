import { parentPort } from 'worker_threads';
import crypto from 'crypto';

/**
 * Worker thread for solving proof-of-work challenges
 *
 * This worker receives challenges from the main thread and attempts to find
 * a nonce that produces a hash meeting the target difficulty.
 */

let currentJobId = null;
let shouldCancel = false;

parentPort.on('message', (msg) => {
  if (msg.type === 'solve') {
    currentJobId = msg.jobId;
    shouldCancel = false;
    solveChallenge(msg);
  } else if (msg.type === 'cancel' && msg.jobId === currentJobId) {
    shouldCancel = true;
    currentJobId = null;
  }
});

/**
 * Solve the challenge by finding a valid nonce
 */
function solveChallenge({ jobId, challenge, startNonce, endNonce }) {
  const { data, target, difficulty, id: challengeId } = challenge;

  // Determine target pattern (e.g., number of leading zeros)
  const targetPrefix = target || '0'.repeat(difficulty || 4);

  let nonce = startNonce;
  let attempts = 0;
  let lastProgressReport = Date.now();
  const progressInterval = 1000; // Report progress every second

  while (nonce < endNonce && !shouldCancel) {
    attempts++;

    // Create hash with challenge data + nonce
    const input = typeof data === 'object' ? JSON.stringify(data) + nonce : `${data}${nonce}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');

    // Check if we found a solution
    if (hash.startsWith(targetPrefix)) {
      parentPort.postMessage({
        type: 'solution',
        jobId,
        challengeId,
        nonce,
        hash,
        attempts
      });
      return;
    }

    nonce++;

    // Report progress periodically
    const now = Date.now();
    if (now - lastProgressReport > progressInterval) {
      const hashRate = attempts / ((now - lastProgressReport) / 1000);
      parentPort.postMessage({
        type: 'progress',
        jobId,
        attempts,
        hashRate,
        currentNonce: nonce
      });
      lastProgressReport = now;
      attempts = 0; // Reset for next interval
    }
  }

  // If we get here, we exhausted our nonce range without finding a solution
  if (!shouldCancel) {
    parentPort.postMessage({
      type: 'exhausted',
      jobId,
      startNonce,
      endNonce
    });
  }
}

/**
 * Alternative solving algorithms can be implemented here
 * For example, using different hash functions or optimization techniques
 */

// Keep the worker alive
setInterval(() => {}, 1000);

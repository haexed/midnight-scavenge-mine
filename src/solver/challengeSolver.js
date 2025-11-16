import crypto from 'crypto';
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});

/**
 * Multi-threaded Challenge Solver for Midnight Scavenger Mine
 *
 * This solver uses a worker pool to efficiently solve proof-of-work challenges
 * by distributing the work across multiple CPU cores.
 */
class ChallengeSolver {
  constructor(config = {}) {
    this.numWorkers = config.numWorkers || cpus().length;
    this.workers = [];
    this.activeJobs = new Map();
    this.jobIdCounter = 0;
    this.stats = {
      challengesSolved: 0,
      totalHashRate: 0,
      averageTimeToSolve: 0
    };
  }

  /**
   * Initialize the worker pool
   */
  async initialize() {
    logger.info({ workers: this.numWorkers }, 'Initializing worker pool...');

    for (let i = 0; i < this.numWorkers; i++) {
      const workerPath = path.join(__dirname, 'worker.js');

      try {
        const worker = new Worker(workerPath);

        worker.on('message', (msg) => this.handleWorkerMessage(msg));
        worker.on('error', (error) => {
          logger.error({ workerId: i, error: error.message }, 'Worker error');
        });
        worker.on('exit', (code) => {
          if (code !== 0) {
            logger.warn({ workerId: i, code }, 'Worker exited unexpectedly');
          }
        });

        this.workers.push({ id: i, worker, busy: false });
      } catch (error) {
        logger.error({ workerId: i, error: error.message }, 'Failed to create worker');
      }
    }

    logger.info({ count: this.workers.length }, 'Worker pool initialized');
  }

  /**
   * Handle messages from workers
   */
  handleWorkerMessage(msg) {
    if (msg.type === 'solution') {
      const job = this.activeJobs.get(msg.jobId);
      if (job) {
        // Cancel all other workers working on this challenge
        this.cancelJob(msg.jobId);

        const timeToSolve = Date.now() - job.startTime;
        this.stats.challengesSolved++;
        this.stats.averageTimeToSolve =
          (this.stats.averageTimeToSolve * (this.stats.challengesSolved - 1) + timeToSolve) /
          this.stats.challengesSolved;

        logger.info({
          jobId: msg.jobId,
          nonce: msg.nonce,
          hash: msg.hash,
          attempts: msg.attempts,
          timeMs: timeToSolve
        }, 'Challenge solved');

        job.resolve({
          nonce: msg.nonce,
          hash: msg.hash,
          attempts: msg.attempts,
          timeMs: timeToSolve
        });

        this.activeJobs.delete(msg.jobId);
      }
    } else if (msg.type === 'progress') {
      // Update hash rate statistics
      this.stats.totalHashRate = msg.hashRate;
    }
  }

  /**
   * Solve a challenge using the worker pool
   * @param {Object} challenge - Challenge data from the API
   * @returns {Promise<Object>} Solution with nonce and hash
   */
  async solve(challenge) {
    const jobId = this.jobIdCounter++;
    const startTime = Date.now();

    logger.info({ jobId, challengeId: challenge.id }, 'Starting challenge solve...');

    return new Promise((resolve, reject) => {
      this.activeJobs.set(jobId, {
        challengeId: challenge.id,
        startTime,
        resolve,
        reject
      });

      // Distribute work across all workers
      const workersPerJob = this.workers.length;
      const nonceRangePerWorker = Math.floor(Number.MAX_SAFE_INTEGER / workersPerJob);

      this.workers.forEach((workerInfo, index) => {
        const startNonce = index * nonceRangePerWorker;
        const endNonce = (index + 1) * nonceRangePerWorker;

        workerInfo.worker.postMessage({
          type: 'solve',
          jobId,
          challenge,
          startNonce,
          endNonce
        });
        workerInfo.busy = true;
      });

      // Set a timeout (e.g., 5 minutes per challenge)
      setTimeout(() => {
        if (this.activeJobs.has(jobId)) {
          this.cancelJob(jobId);
          reject(new Error('Challenge solve timeout'));
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Cancel a job and free up workers
   */
  cancelJob(jobId) {
    this.workers.forEach((workerInfo) => {
      workerInfo.worker.postMessage({ type: 'cancel', jobId });
      workerInfo.busy = false;
    });
  }

  /**
   * Get solver statistics
   */
  getStats() {
    return {
      ...this.stats,
      workers: this.workers.length,
      activeJobs: this.activeJobs.size,
      hashRate: `${(this.stats.totalHashRate / 1000000).toFixed(2)} MH/s`
    };
  }

  /**
   * Shutdown the worker pool
   */
  async shutdown() {
    logger.info('Shutting down worker pool...');
    for (const workerInfo of this.workers) {
      await workerInfo.worker.terminate();
    }
    this.workers = [];
    this.activeJobs.clear();
  }
}

/**
 * Simple single-threaded solver for testing
 * @param {Object} challenge - Challenge data
 * @param {string} challenge.data - Challenge data to hash
 * @param {string} challenge.target - Target hash (leading zeros)
 * @returns {Object} Solution with nonce and hash
 */
export function solveSimple(challenge) {
  const { data, target, difficulty } = challenge;
  let nonce = 0;
  let hash;
  let attempts = 0;

  const targetPrefix = '0'.repeat(difficulty || 4); // Default to 4 leading zeros

  while (true) {
    attempts++;
    const input = `${data}${nonce}`;
    hash = crypto.createHash('sha256').update(input).digest('hex');

    if (hash.startsWith(targetPrefix)) {
      return { nonce, hash, attempts };
    }

    nonce++;

    // Safety limit
    if (nonce > 10000000) {
      throw new Error('Exceeded maximum attempts');
    }
  }
}

export default ChallengeSolver;

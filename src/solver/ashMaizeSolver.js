import { cpus } from 'os';
import pino from 'pino';
import HashEngine from './hashEngine.js';

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: true,
      messageFormat: '{msg}'
    }
  }
});

/**
 * AshMaize Challenge Solver
 *
 * Uses the Rust hash engine with batch processing for maximum performance
 */
class AshMaizeSolver {
  constructor(config = {}) {
    this.batchSize = config.batchSize || 300; // Optimal batch size from ADA-Markets
    this.numWorkers = config.numWorkers || cpus().length;
    this.hashEngine = new HashEngine({
      port: config.hashEnginePort || 9001
    });
    this.address = config.address;

    // Sequential nonce counter - much faster than random generation
    this.nonceCounter = BigInt(Date.now() * 1000000 + Math.floor(Math.random() * 1000000));

    this.stats = {
      challengesSolved: 0,
      totalHashRate: 0,
      averageTimeToSolve: 0,
      totalHashes: 0
    };
  }

  /**
   * Initialize the solver and hash engine
   */
  async initialize() {
    logger.info({ workers: this.numWorkers, batchSize: this.batchSize }, 'Initializing AshMaize solver...');
    await this.hashEngine.start();
    logger.info('✓ AshMaize solver ready');
  }

  /**
   * Generate a 16-character hex nonce using sequential counter
   * Much faster than random generation, covers same search space
   */
  generateNonce() {
    this.nonceCounter += 1n;
    const hex = this.nonceCounter.toString(16).padStart(16, '0');
    return hex.substring(0, 16);
  }

  /**
   * Solve a challenge by finding a valid nonce
   *
   * @param {Object} challenge - Challenge data from API
   * @returns {Promise<Object>} Solution with nonce and hash
   */
  async solve(challenge) {
    // Defensive checks - fail fast with full context
    if (!challenge) {
      throw new Error('FATAL: solve() called with null/undefined challenge');
    }

    if (!challenge.id || !challenge.difficulty || !challenge.no_pre_mine) {
      throw new Error(`FATAL: Invalid challenge object missing required fields. Challenge: ${JSON.stringify(challenge)}`);
    }

    if (!this.address) {
      throw new Error('FATAL: No address configured for solver. Cannot mine without an address.');
    }

    if (!this.address.startsWith('addr1')) {
      throw new Error(`FATAL: Invalid address format: ${this.address}. Must start with 'addr1'`);
    }

    const startTime = Date.now();
    const address = this.address; // Local reference for buildPreimage calls

    logger.info({
      challengeId: challenge.id,
      difficulty: challenge.difficulty,
      address: address.substring(0, 20) + '...'
    }, 'Solving challenge...');

    // Initialize ROM for this challenge
    await this.hashEngine.initROM(challenge);

    let attempts = 0;
    let found = false;
    let solution = null;

    // Keep trying until we find a solution
    while (!found) {
      // Generate batch of preimages
      const batch = [];
      const nonces = [];

      for (let i = 0; i < this.batchSize; i++) {
        const nonce = this.generateNonce();
        const preimage = this.hashEngine.buildPreimage(nonce, address, challenge);
        batch.push(preimage);
        nonces.push(nonce);
      }

      // Hash entire batch in parallel on Rust side
      const hashes = await this.hashEngine.hashBatch(batch);

      // Check each hash for solution
      for (let i = 0; i < hashes.length; i++) {
        attempts++;
        this.stats.totalHashes++;

        if (this.hashEngine.meetsDifficulty(hashes[i], challenge.difficulty)) {
          found = true;
          solution = {
            nonce: nonces[i],
            hash: hashes[i],
            attempts,
            timeMs: Date.now() - startTime
          };

          this.stats.challengesSolved++;
          this.stats.averageTimeToSolve =
            (this.stats.averageTimeToSolve * (this.stats.challengesSolved - 1) + solution.timeMs) /
            this.stats.challengesSolved;

          logger.info({
            nonce: solution.nonce,
            hash: solution.hash.substring(0, 32) + '...',
            attempts: solution.attempts,
            timeMs: solution.timeMs,
            hashRate: ((attempts / solution.timeMs) * 1000).toFixed(2) + ' H/s'
          }, '✓ Challenge solved!');

          break;
        }
      }

      // Log progress every 10 batches
      if (attempts % (this.batchSize * 10) === 0) {
        const elapsed = Date.now() - startTime;
        const hashRate = (attempts / elapsed) * 1000;
        logger.debug({
          attempts,
          elapsed: `${(elapsed / 1000).toFixed(1)}s`,
          hashRate: `${hashRate.toFixed(2)} H/s`
        }, 'Mining progress...');
      }
    }

    return solution;
  }

  /**
   * Get solver statistics
   */
  getStats() {
    return {
      ...this.stats,
      workers: this.numWorkers,
      batchSize: this.batchSize,
      hashRate: this.stats.totalHashes > 0
        ? `${(this.stats.totalHashRate / 1000000).toFixed(2)} MH/s`
        : 'N/A'
    };
  }

  /**
   * Shutdown the solver
   */
  async shutdown() {
    logger.info('Shutting down AshMaize solver...');
    await this.hashEngine.stop();
    logger.info('✓ AshMaize solver stopped');
  }
}

export default AshMaizeSolver;

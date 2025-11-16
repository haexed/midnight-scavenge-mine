import { spawn } from 'child_process';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 * Hash Engine Manager
 *
 * Manages the Rust-based AshMaize hash engine HTTP server
 */
class HashEngine {
  constructor(config = {}) {
    this.port = config.port || 9001;
    this.host = config.host || '127.0.0.1';
    this.baseURL = `http://${this.host}:${this.port}`;
    this.process = null;
    this.initialized = false;
    this.currentChallenge = null;

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 120000 // Increased to 120s for large batches (1000+ preimages)
    });
  }

  /**
   * Start the hash engine server
   */
  async start() {
    if (this.process) {
      logger.warn('Hash engine already running');
      return;
    }

    const binaryPath = path.join(__dirname, '../../bin/hash-server');

    // Defensive check: ensure binary exists
    const fs = await import('fs');
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`FATAL: Hash engine binary not found at ${binaryPath}. Did you forget to build it?`);
    }

    // Check if port is already in use
    try {
      await this.client.get('/health');
      throw new Error(`FATAL: Port ${this.port} already in use! Another hash-server instance may be running.`);
    } catch (error) {
      // Good - port is free (connection refused is expected)
      if (!error.message.includes('ECONNREFUSED') && !error.message.includes('already in use')) {
        // Unexpected error
        logger.warn({ error: error.message }, 'Unexpected error checking port');
      }
    }

    logger.info({ port: this.port }, 'Starting hash engine server...');

    this.process = spawn(binaryPath, [], {
      env: {
        ...process.env,
        RUST_LOG: 'info',
        PORT: this.port.toString(),
        HOST: this.host
      }
    });

    this.process.stdout.on('data', (data) => {
      logger.debug({ output: data.toString().trim() }, 'Hash engine');
    });

    this.process.stderr.on('data', (data) => {
      const msg = data.toString().trim();

      // Rust binaries output INFO logs to stderr - only log actual errors
      if (msg.includes('ERROR') || msg.includes('WARN')) {
        // Truncate long messages
        const truncated = msg.length > 150 ? msg.substring(0, 150) + '...' : msg;
        logger.error({ error: truncated }, 'Hash engine error');
      } else if (msg.includes('FATAL') || msg.includes('panic')) {
        logger.error({ error: msg.substring(0, 200) }, 'Hash engine FATAL');
      }
      // Suppress INFO/DEBUG from cluttering logs
    });

    this.process.on('exit', (code) => {
      // Only warn on unexpected exits (code 0 = clean, code 1 = normal shutdown)
      if (code !== 0 && code !== 1 && code !== null) {
        logger.warn({ code }, 'Hash engine process exited unexpectedly');
      }
      this.process = null;
      this.initialized = false;
    });

    // Wait for server to be ready
    await this.waitForReady();

    logger.info('✓ Hash engine ready');
  }

  /**
   * Wait for the hash engine to be ready
   */
  async waitForReady(maxAttempts = 30) {
    let lastError = null;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        await this.client.get('/health');
        return;
      } catch (e) {
        lastError = e;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Failed to start - dump diagnostic info
    throw new Error(
      `FATAL: Hash engine failed to start after ${maxAttempts * 100}ms!\n` +
      `  Port: ${this.port}\n` +
      `  Process running: ${!!this.process}\n` +
      `  Process PID: ${this.process?.pid || 'none'}\n` +
      `  Last error: ${lastError?.message}\n` +
      `  Check if port ${this.port} is blocked or if the binary crashed on startup.`
    );
  }

  /**
   * Initialize ROM for a new challenge
   *
   * @param {Object} challenge - Challenge data from API
   * @param {string} challenge.no_pre_mine - ROM initialization key
   */
  async initROM(challenge) {
    // Auto-restart if process died
    if (!this.process) {
      logger.warn('Hash engine process not running - attempting auto-restart...');

      try {
        // Restart the hash-server
        await this.start();
        logger.info('Hash engine restarted successfully');
      } catch (restartError) {
        logger.error({ error: restartError.message }, 'Failed to restart hash engine');
        throw new Error(`FATAL: Hash engine process not running and auto-restart failed: ${restartError.message}`);
      }
    }

    if (!challenge.no_pre_mine) {
      throw new Error(`FATAL: Invalid challenge - missing no_pre_mine field. Challenge: ${JSON.stringify(challenge)}`);
    }

    logger.info({ no_pre_mine: challenge.no_pre_mine }, 'Initializing ROM...');

    try {
      const response = await this.client.post('/init', {
        no_pre_mine: challenge.no_pre_mine,
        ashConfig: {
          nbLoops: 8,
          nbInstrs: 256,
          pre_size: 16777216,
          rom_size: 1073741824,
          mixing_numbers: 4
        }
      });

      if (!response.data) {
        throw new Error(`FATAL: Hash engine returned no data. Response status: ${response.status}`);
      }

      this.initialized = true;
      this.currentChallenge = challenge;

      logger.info('✓ ROM initialized');

      return response.data;
    } catch (error) {
      // Check if it's a connection error (process died during init)
      const isDeadProcess = error.code === 'ECONNREFUSED' ||
                           error.code === 'ECONNRESET' ||
                           error.message?.includes('socket hang up') ||
                           error.message?.includes('connect ECONNREFUSED');

      if (isDeadProcess) {
        logger.warn('Hash server died during ROM init - attempting recovery...');

        try {
          // Clean up dead process
          this.process = null;
          this.initialized = false;

          // Restart hash-server
          await this.start();

          // Retry ROM initialization
          logger.info('Hash server restarted - retrying ROM init...');

          const retryResponse = await this.client.post('/init', {
            no_pre_mine: challenge.no_pre_mine,
            ashConfig: {
              nbLoops: 8,
              nbInstrs: 256,
              pre_size: 16777216,
              rom_size: 1073741824,
              mixing_numbers: 4
            }
          });

          if (!retryResponse.data) {
            throw new Error(`FATAL: Hash engine returned no data after restart. Response status: ${retryResponse.status}`);
          }

          this.initialized = true;
          this.currentChallenge = challenge;

          logger.info('✓ ROM initialized after recovery');

          return retryResponse.data;

        } catch (recoveryError) {
          logger.error({ error: recoveryError.message }, 'Failed to recover from hash server crash during ROM init');
          // Fall through to original error handling
        }
      }

      // Original error handling for non-recoverable errors
      logger.error({
        error: error.message,
        stack: error.stack,
        challenge_id: challenge.id,
        no_pre_mine: challenge.no_pre_mine,
        engine_port: this.port
      }, 'FATAL: Failed to initialize ROM');
      throw new Error(`ROM initialization failed for challenge ${challenge.id}: ${error.message}\nStack: ${error.stack}`);
    }
  }

  /**
   * Build preimage string according to Midnight spec
   *
   * Format: nonce + address + challengeId + difficulty + no_pre_mine + latest_submission + no_pre_mine_hour
   *
   * @param {string} nonce - 16 hex char nonce
   * @param {string} address - Cardano address
   * @param {Object} challenge - Challenge data
   */
  buildPreimage(nonce, address, challenge) {
    // Ensure challenge ID has ** prefix
    const challengeId = challenge.id.startsWith('**') ? challenge.id : `**${challenge.id}`;

    const preimage = (
      nonce +
      address +
      challengeId +
      challenge.difficulty +
      challenge.no_pre_mine +
      challenge.latest_submission +
      challenge.no_pre_mine_hour
    );

    return preimage;
  }

  /**
   * Hash a single preimage
   *
   * @param {string} preimage - Preimage string
   * @returns {string} 128-char hex hash
   */
  async hashPreimage(preimage) {
    if (!this.initialized) {
      throw new Error('ROM not initialized - call initROM first');
    }

    try {
      const response = await this.client.post('/hash', { preimage });
      return response.data.hash;
    } catch (error) {
      logger.error({ error: error.message }, 'Hash computation failed');
      throw error;
    }
  }

  /**
   * Hash multiple preimages in parallel (batch processing)
   *
   * @param {string[]} preimages - Array of preimage strings
   * @returns {string[]} Array of 128-char hex hashes
   */
  async hashBatch(preimages) {
    if (!this.initialized) {
      throw new Error(`FATAL: ROM not initialized - call initROM first. Process running: ${!!this.process}, Current challenge: ${this.currentChallenge?.id || 'none'}`);
    }

    if (!Array.isArray(preimages) || preimages.length === 0) {
      throw new Error(`FATAL: Invalid preimages array. Type: ${typeof preimages}, Length: ${preimages?.length}, Value: ${JSON.stringify(preimages).substring(0, 100)}`);
    }

    try {
      const response = await this.client.post('/hash-batch', { preimages });

      if (!response.data || !Array.isArray(response.data.hashes)) {
        throw new Error(`FATAL: Invalid hash-batch response. Status: ${response.status}, Data: ${JSON.stringify(response.data).substring(0, 200)}`);
      }

      if (response.data.hashes.length !== preimages.length) {
        throw new Error(`FATAL: Hash count mismatch! Sent ${preimages.length} preimages, got ${response.data.hashes.length} hashes back`);
      }

      return response.data.hashes;
    } catch (error) {
      // Detect if hash-server process has died
      const isDeadProcess = error.code === 'ECONNREFUSED' ||
                           error.code === 'ECONNRESET' ||
                           error.message?.includes('socket hang up') ||
                           error.message?.includes('connect ECONNREFUSED');

      if (isDeadProcess && this.currentChallenge) {
        logger.warn('Hash server appears to have crashed - attempting auto-restart...');

        try {
          // Clean up dead process
          this.process = null;
          this.initialized = false;

          // Restart hash-server
          await this.start();

          // Re-initialize ROM with current challenge
          await this.initROM(this.currentChallenge);

          logger.info('Hash server restarted successfully - retrying batch...');

          // Retry the hash batch operation
          const retryResponse = await this.client.post('/hash-batch', { preimages });

          if (!retryResponse.data || !Array.isArray(retryResponse.data.hashes)) {
            throw new Error(`FATAL: Invalid hash-batch response after restart. Status: ${retryResponse.status}`);
          }

          if (retryResponse.data.hashes.length !== preimages.length) {
            throw new Error(`FATAL: Hash count mismatch after restart! Sent ${preimages.length}, got ${retryResponse.data.hashes.length}`);
          }

          return retryResponse.data.hashes;

        } catch (restartError) {
          logger.error({ error: restartError.message }, 'Failed to restart hash server');
          // Fall through to original error handling
        }
      }

      // Original error handling for non-recoverable errors
      logger.error({
        error: error.message,
        stack: error.stack,
        preimage_count: preimages.length,
        first_preimage: preimages[0]?.substring(0, 100),
        initialized: this.initialized,
        process_running: !!this.process,
        challenge_id: this.currentChallenge?.id
      }, 'FATAL: Batch hash failed');
      throw new Error(`Batch hash failed (${preimages.length} preimages, challenge ${this.currentChallenge?.id}): ${error.message}\nStack: ${error.stack}`);
    }
  }

  /**
   * Check if hash meets difficulty target
   *
   * @param {string} hash - 128-char hex hash
   * @param {string} difficulty - 8-char hex difficulty mask
   * @returns {boolean}
   */
  meetsDifficulty(hash, difficulty) {
    // Per Midnight spec: "The zero bits in the difficulty are the same as the zero bits of the hash"
    // This means: where difficulty has 0, hash must also have 0
    // Check: (hash & ~difficulty) === 0
    const hashPrefix = hash.substring(0, 8);
    const hashValue = parseInt(hashPrefix, 16);
    const difficultyValue = parseInt(difficulty, 16);

    // Where difficulty bits are 0, hash bits must also be 0
    return (hashValue & ~difficultyValue) === 0;
  }

  /**
   * Stop the hash engine server
   */
  async stop() {
    if (this.process) {
      const pid = this.process.pid;
      logger.info({ pid }, 'Stopping hash engine...');

      // Try graceful shutdown first
      this.process.kill('SIGTERM');

      // Wait 500ms for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check if still alive, force kill if needed
      try {
        process.kill(pid, 0); // Check if process exists
        logger.warn({ pid }, 'Hash engine did not respond to SIGTERM, sending SIGKILL');
        this.process.kill('SIGKILL');
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        // Process already dead (kill(pid, 0) throws if process doesn't exist)
        logger.info({ pid }, '✓ Hash engine stopped gracefully');
      }

      this.process = null;
      this.initialized = false;
    }
  }

  /**
   * Check if ROM is ready
   */
  isReady() {
    return this.initialized && this.process !== null;
  }
}

export default HashEngine;

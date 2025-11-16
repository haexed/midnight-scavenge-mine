#!/usr/bin/env node

/**
 * RECEIPTS TRACKER - Per-Address Solution Tracking
 *
 * Maintains a database of which addresses have solved which challenges
 * to prevent wasting power re-mining already-solved combinations.
 *
 * Data structure:
 * {
 *   "addr1...": {
 *     "**D11C20": { "nonce": "...", "timestamp": "...", "receipt": {...} },
 *     "**D11C19": { "nonce": "...", "timestamp": "...", "receipt": {...} }
 *   }
 * }
 */

import fs from 'fs';
import path from 'path';

const RECEIPTS_FILE = './receipts-db.json';

class ReceiptsTracker {
  constructor() {
    this.receipts = this.load();
  }

  load() {
    if (fs.existsSync(RECEIPTS_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(RECEIPTS_FILE, 'utf8'));
      } catch (error) {
        console.error(`Error loading receipts: ${error.message}`);
        return {};
      }
    }
    return {};
  }

  save() {
    try {
      fs.writeFileSync(RECEIPTS_FILE, JSON.stringify(this.receipts, null, 2));
    } catch (error) {
      console.error(`Error saving receipts: ${error.message}`);
    }
  }

  /**
   * Check if an address has already solved a challenge
   */
  hasSolved(address, challengeId) {
    return this.receipts[address]?.[challengeId] !== undefined;
  }

  /**
   * Record a successful solution
   */
  recordSolution(address, challengeId, nonce, receipt = null) {
    if (!this.receipts[address]) {
      this.receipts[address] = {};
    }

    this.receipts[address][challengeId] = {
      nonce,
      timestamp: new Date().toISOString(),
      receipt: receipt || 'not saved'
    };

    this.save();
  }

  /**
   * Get all solved challenges for an address
   */
  getSolved(address) {
    return Object.keys(this.receipts[address] || {});
  }

  /**
   * Get all unsolved challenges for an address from a list
   */
  getUnsolved(address, challengeIds) {
    const solved = new Set(this.getSolved(address));
    return challengeIds.filter(id => !solved.has(id));
  }

  /**
   * Get statistics
   */
  getStats() {
    const stats = {
      totalAddresses: Object.keys(this.receipts).length,
      totalSolutions: 0,
      byAddress: {}
    };

    for (const [address, challenges] of Object.entries(this.receipts)) {
      const shortAddr = address.substring(0, 20) + '...';
      const count = Object.keys(challenges).length;
      stats.byAddress[shortAddr] = count;
      stats.totalSolutions += count;
    }

    return stats;
  }

  /**
   * Export to format compatible with existing miners
   */
  exportSolvedChallenges() {
    const allChallenges = new Set();

    for (const addressData of Object.values(this.receipts)) {
      for (const challengeId of Object.keys(addressData)) {
        allChallenges.add(challengeId);
      }
    }

    return Array.from(allChallenges).sort();
  }
}

// Export singleton instance
const tracker = new ReceiptsTracker();
export default tracker;

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  if (command === 'stats') {
    const stats = tracker.getStats();
    console.log('📊 Receipt Tracker Statistics:\n');
    console.log(`Total addresses: ${stats.totalAddresses}`);
    console.log(`Total solutions: ${stats.totalSolutions}\n`);
    console.log('Solutions by address:');
    for (const [addr, count] of Object.entries(stats.byAddress)) {
      console.log(`  ${addr} ${count} solutions`);
    }
  } else if (command === 'export') {
    const solved = tracker.exportSolvedChallenges();
    console.log(JSON.stringify(solved, null, 2));
  } else if (command === 'check') {
    const address = process.argv[3];
    const challengeId = process.argv[4];

    if (!address || !challengeId) {
      console.log('Usage: ./receipts-tracker.js check <address> <challengeId>');
      process.exit(1);
    }

    const solved = tracker.hasSolved(address, challengeId);
    console.log(`${address.substring(0, 20)}... has ${solved ? 'SOLVED' : 'NOT solved'} ${challengeId}`);
  } else {
    console.log(`
Receipt Tracker CLI

Usage:
  ./receipts-tracker.js stats              Show statistics
  ./receipts-tracker.js export             Export solved challenge IDs
  ./receipts-tracker.js check <addr> <id>  Check if address solved challenge

Database: ${RECEIPTS_FILE}
    `);
  }
}

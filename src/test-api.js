#!/usr/bin/env node

/**
 * API Test Script
 *
 * Quick test to verify the Midnight Scavenger Mine API is accessible
 */

import ScavengerMineClient from './api/client.js';
import chalk from 'chalk';

console.log(chalk.cyan('🧪 API Test\n'));

async function testAPI() {
  const client = new ScavengerMineClient({
    baseURL: process.env.API_BASE_URL || 'https://sm.midnight.gd/api'
  });

  console.log(chalk.blue('Testing Midnight Scavenger Mine API...\n'));

  // Test 1: Terms and Conditions
  console.log(chalk.yellow('1️⃣  Testing /TandC endpoint...'));
  try {
    const terms = await client.getTermsAndConditions();
    console.log(chalk.green('   ✓ /TandC endpoint working'));
    console.log(chalk.gray(`   Response type: ${typeof terms}\n`));
  } catch (error) {
    console.log(chalk.red(`   ✗ /TandC failed: ${error.message}`));
    if (error.response) {
      console.log(chalk.red(`   Status: ${error.response.status}`));
      console.log(chalk.red(`   ${JSON.stringify(error.response.data, null, 2)}`));
    }
    console.log();
  }

  // Test 2: Get Challenge
  console.log(chalk.yellow('2️⃣  Testing /challenge endpoint...'));
  try {
    const challenge = await client.getChallenge();
    console.log(chalk.green('   ✓ /challenge endpoint working'));
    console.log(chalk.gray(`   Challenge ID: ${challenge.id || 'N/A'}`));
    console.log(chalk.gray(`   Difficulty: ${challenge.difficulty || 'N/A'}`));
    console.log(chalk.gray(`   Cycle: ${challenge.cycle || 'N/A'}`));
    console.log(chalk.gray(`   Data: ${JSON.stringify(challenge.data || 'N/A').substring(0, 50)}...`));
    console.log();

    // Test 3: Challenge Structure
    console.log(chalk.yellow('3️⃣  Validating challenge structure...'));
    const requiredFields = ['id', 'data', 'difficulty'];
    const hasAllFields = requiredFields.every(field => field in challenge);

    if (hasAllFields) {
      console.log(chalk.green('   ✓ Challenge has all required fields'));
    } else {
      console.log(chalk.yellow('   ⚠️  Challenge structure differs from expected'));
      console.log(chalk.gray(`   Available fields: ${Object.keys(challenge).join(', ')}`));
    }
    console.log();

  } catch (error) {
    console.log(chalk.red(`   ✗ /challenge failed: ${error.message}`));
    if (error.response) {
      console.log(chalk.red(`   Status: ${error.response.status}`));
      console.log(chalk.red(`   ${JSON.stringify(error.response.data, null, 2)}`));
    }
    console.log();
  }

  // Test 4: Check Event Status
  console.log(chalk.yellow('4️⃣  Checking Scavenger Mine event status...'));
  const now = new Date();
  const startDate = new Date('2025-10-29');
  const endDate = new Date('2025-11-19');

  if (now >= startDate && now <= endDate) {
    console.log(chalk.green('   ✓ Scavenger Mine event is active!'));
    const daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
    console.log(chalk.gray(`   Days remaining: ${daysRemaining}`));
  } else if (now < startDate) {
    console.log(chalk.yellow('   ⏱️  Event has not started yet'));
    const daysUntil = Math.ceil((startDate - now) / (1000 * 60 * 60 * 24));
    console.log(chalk.gray(`   Starts in: ${daysUntil} days`));
  } else {
    console.log(chalk.red('   ⚠️  Event has ended'));
  }
  console.log();

  // Summary
  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.green.bold('✨ API Test Complete!\n'));
  console.log(chalk.white('Next steps:'));
  console.log(chalk.gray('  1. Configure your Cardano address in config.json or .env'));
  console.log(chalk.gray('  2. Review and accept the Terms and Conditions'));
  console.log(chalk.gray('  3. Start mining with: npm start start\n'));
}

// Run tests
testAPI().catch(error => {
  console.error(chalk.red('\n❌ Fatal error during testing:'), error.message);
  process.exit(1);
});

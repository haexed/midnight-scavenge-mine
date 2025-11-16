import fs from 'fs';
import chalk from 'chalk';
import path from 'path';

/**
 * Dual logger - writes to both console (with colors) and file (without colors)
 */
class DualLogger {
  constructor(logFileName) {
    this.logFile = path.join(process.cwd(), 'logs', logFileName);

    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Write header
    const header = `\n${'='.repeat(80)}\nLog started: ${new Date().toISOString()}\n${'='.repeat(80)}\n`;
    fs.appendFileSync(this.logFile, header);
  }

  /**
   * Strip ANSI color codes from string
   */
  stripColors(text) {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /**
   * Write to both console and file
   */
  log(consoleText, fileText = null) {
    // Print to console with colors
    console.log(consoleText);

    // Write to file without colors
    const timestamp = new Date().toISOString();
    const textToWrite = fileText !== null ? fileText : this.stripColors(consoleText);
    fs.appendFileSync(this.logFile, `[${timestamp}] ${textToWrite}\n`);
  }

  /**
   * Write raw text (no timestamp)
   */
  raw(text) {
    console.log(text);
    fs.appendFileSync(this.logFile, this.stripColors(text) + '\n');
  }

  /**
   * Convenience methods
   */
  info(message) {
    this.log(chalk.cyan(message));
  }

  success(message) {
    this.log(chalk.green(message));
  }

  warning(message) {
    this.log(chalk.yellow(message));
  }

  error(message) {
    this.log(chalk.red(message));
  }

  debug(message) {
    this.log(chalk.gray(message));
  }
}

export default DualLogger;

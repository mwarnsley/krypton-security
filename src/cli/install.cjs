#!/usr/bin/env node
const childProcess = require('node:child_process');
const { promisify } = require('node:util');
const { main: setup } = require('./setup.cjs');

/**
 * Delivers a fixed completion notice without exposing client configuration.
 * @returns {Promise<void>} Rejects on denied delivery, timeout, or output overflow.
 */
async function notifySetupComplete() {
  await promisify(childProcess.execFile)(
    '/usr/bin/osascript',
    [
      '-e',
      'display notification "Setup finished. Review console results and restart configured clients." with title "Krypton Setup"',
    ],
    { timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 4096 }
  );
}

/**
 * Runs source-checkout setup, then a bounded macOS completion notification.
 * @param {string[]} argv - Literal arguments; no arguments are accepted.
 * @param {import('./install.cjs').InstallOptions} options - Setup and notification boundaries.
 * @returns {Promise<number>} 0 on success, 2 for usage, 1 for operational failure.
 * Notification failure never rolls back settings or claims protection is active.
 */
async function main(argv = process.argv.slice(2), options = {}) {
  const writeError = options.writeError ?? ((text) => process.stderr.write(text));
  if (argv.length !== 0) {
    writeError('Usage: Install-Mac.command\n');
    return 2;
  }
  if ((options.platform ?? process.platform) !== 'darwin') {
    writeError('FAILED Krypton installer: unsupported_platform; this launcher requires macOS.\n');
    return 1;
  }
  const code = await setup([], options);
  if (code !== 0) return code;
  try {
    await (options.notify ?? notifySetupComplete)();
  } catch (error) {
    // Deliberately never echo subprocess output, paths, or arbitrary exception text.
    const category = error instanceof Error ? 'notification_failed' : 'notification_unexpected';
    writeError(
      `FAILED Krypton installer: ${category}; settings were not rolled back. Review setup results.\n`
    );
    return 1;
  }
  return 0;
}

module.exports = { main, notifySetupComplete };
if (require.main === module) void require('./runtime.cjs').runCli(main);

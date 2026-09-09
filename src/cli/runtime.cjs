/**
 * Owns terminal promise and stream failures for a CLI process.
 * @param {function(string[]): Promise<number>} main - Command implementation.
 * @param {string[]} argv - Literal arguments.
 * @param {function(): void} onFailure - Releases command resources on terminal failure.
 * @returns {Promise<void>} Settles after assigning an exit code; never rejects.
 */
async function runCli(main, argv = process.argv.slice(2), onFailure = () => undefined) {
  let failed = false;
  const fail = () => {
    failed = true;
    process.exitCode = 1;
    try {
      onFailure();
    } catch (error) {
      // Terminal cleanup failure cannot recover the command or safely log again.
      if (error !== undefined) process.exitCode = 1;
    }
  };
  process.stderr.on('error', fail);
  process.stdout.on('error', fail);
  try {
    const code = await main(argv);
    process.exitCode = failed || !Number.isInteger(code) || code < 0 || code > 255 ? 1 : code;
  } catch (error) {
    fail();
    const category = error instanceof Error ? 'operation_failed' : 'unexpected_failure';
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        process.stderr.off('close', finish);
        resolve();
      };
      const timer = setTimeout(() => {
        process.stderr.destroy();
        finish();
      }, 1500);
      process.stderr.once('close', finish);
      try {
        process.stderr.write(`[KRYPTON] ${category}; command failed closed.\n`, (writeError) => {
          if (writeError) {
            process.stderr.destroy();
            fail();
          }
          finish();
        });
      } catch (writeError) {
        if (writeError !== undefined) fail();
        process.stderr.destroy();
        finish();
      }
    });
  }
}

module.exports = { runCli };

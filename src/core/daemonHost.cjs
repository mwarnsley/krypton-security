const { spawn } = require('node:child_process');
const { createWriteStream } = require('node:fs');
const { isAbsolute } = require('node:path');
const { constants } = require('node:os');

const MAX_LOG_BYTES = 64 * 1024;
const SHUTDOWN_GRACE_MS = 1500;

/**
 * Owns one native daemon and its inherited private log descriptor until exit.
 * The caller supplies a fresh, empty private regular file as fd 3. Output is
 * copied asynchronously up to a combined 64 KiB, then continuously discarded.
 * Log queues are bounded by that same budget. No retry or restart occurs.
 * Signals and terminal failures stop only the returned child object, escalating
 * after 1500 ms and allowing 1500 ms for reap confirmation. Kernel I/O and
 * scheduling cannot be forcibly bounded; failed signaling returns failure and
 * cannot promise the native child stopped. No exception text is externalized.
 * @param {string} binaryPath - Absolute native executable, without arguments.
 * @param {import('./daemonHost.cjs').DaemonHostDependencies} dependencies - Optional process, log and signal boundaries.
 * @returns {Promise<number>} Native exit status, 2 for invalid input, or 1 for operational, logging or cleanup failure; never intentionally rejects.
 * @complexity O(L + B) time for path length L and streamed bytes B; O(64 KiB) retained log data plus fixed stream buffers.
 * @example await runDaemonHost('/checkout/src/core-native/target/debug/krypton-core'); // follows daemon lifetime
 */
async function runDaemonHost(binaryPath, dependencies = {}) {
  if (
    typeof binaryPath !== 'string' ||
    binaryPath.length > 4096 ||
    !isAbsolute(binaryPath) ||
    binaryPath.includes('\0')
  )
    return 2;

  const signals = dependencies.signals ?? process;
  let log;
  try {
    log = (dependencies.createLog ?? (() => createWriteStream(null, { fd: 3 })))();
  } catch (error) {
    // The inherited descriptor could not be owned; no child has been created.
    void error;
    return 1;
  }

  return new Promise((resolve) => {
    let child;
    let failed = false;
    let settled = false;
    let stopping = false;
    let childExited = false;
    let childClosed = false;
    let logClosing = false;
    let logAbandoned = false;
    let logClosed = false;
    let status = 1;
    let accepted = 0;
    let pending = 0;
    let childTimer;
    let logTimer;

    /**
     * Settles once both child and descriptor lifetimes have ended or timed out.
     * @returns {void} Releases host listeners and timer resources.
     * @complexity O(1) time and space.
     * @example finish(); // resolves only after both lifetimes end
     */
    function finish() {
      if (settled || !childClosed || !logClosed) return;
      settled = true;
      clearTimeout(childTimer);
      clearTimeout(logTimer);
      signals.removeListener('SIGTERM', terminate);
      signals.removeListener('SIGINT', interrupt);
      signals.removeListener('uncaughtException', fail);
      signals.removeListener('unhandledRejection', fail);
      resolve(failed ? 1 : status);
    }

    /**
     * Destroys the log on failure without exposing private failure details.
     * @returns {void} Marks logging failed and bounds descriptor cleanup.
     * @complexity O(1) time and space.
     * @example abandonLog(); // no further output is accepted
     */
    function abandonLog() {
      failed = true;
      if (logClosed || logAbandoned) return finish();
      logAbandoned = true;
      logClosing = true;
      clearTimeout(logTimer);
      logTimer = setTimeout(() => {
        logClosed = true;
        finish();
      }, SHUTDOWN_GRACE_MS);
      try {
        log.destroy();
      } catch (error) {
        // Closing cannot recover logging; its existing deadline remains active.
        void error;
      }
    }

    /**
     * Closes the private log after the native output streams have closed.
     * @returns {void} Starts a bounded asynchronous flush and close.
     * @complexity O(1) setup with at most 64 KiB already queued.
     * @example closeLog(); // resolves after close, or fails after timeout
     */
    function closeLog() {
      if (logClosing || logClosed) return finish();
      logClosing = true;
      clearTimeout(logTimer);
      logTimer = setTimeout(abandonLog, SHUTDOWN_GRACE_MS);
      try {
        log.end();
      } catch (error) {
        fail(error);
      }
    }

    /**
     * Releases native pipes once their bounded cleanup period expires.
     * @returns {void} Records failed cleanup and stops retaining child handles.
     * @complexity O(1) time and space.
     * @example abandonChild(); // terminal failure, never PID-based signaling
     */
    function abandonChild() {
      failed = true;
      childClosed = true;
      for (const stream of [child?.stdout, child?.stderr]) {
        try {
          stream?.destroy();
        } catch (error) {
          // One failed pipe cleanup must not prevent releasing other handles.
          void error;
        }
      }
      try {
        child?.unref();
      } catch (error) {
        // Failed handle cleanup remains a failure even if the native child exited.
        void error;
      }
      closeLog();
    }

    /**
     * Delivers a signal only through the owned, still-live child object.
     * @param {NodeJS.Signals} signal - Requested termination signal.
     * @returns {void} Records unsuccessful delivery as operational failure.
     * @complexity O(1) time and space.
     * @example signalChild('SIGTERM'); // never process.kill(pid)
     */
    function signalChild(signal) {
      if (!child || childExited || child.pid === undefined) return;
      try {
        if (!child.kill(signal)) failed = true;
      } catch (error) {
        void error;
        failed = true;
      }
    }

    /**
     * Starts bounded termination and reap confirmation for the owned child.
     * @param {NodeJS.Signals} signal - Initial forwarded signal.
     * @returns {void} Repeated shutdown requests do not extend deadlines.
     * @complexity O(1) time and space.
     * @example stop('SIGTERM'); // SIGKILL follows after the grace period
     */
    function stop(signal) {
      if (stopping || settled || childClosed || childExited) return;
      stopping = true;
      if (!child || child.pid === undefined) {
        childClosed = true;
        closeLog();
        return;
      }
      childTimer = setTimeout(() => {
        signalChild('SIGKILL');
        childTimer = setTimeout(abandonChild, SHUTDOWN_GRACE_MS);
      }, SHUTDOWN_GRACE_MS);
      signalChild(signal);
    }

    /**
     * Owns asynchronous failures without printing paths, arguments or secrets.
     * @param {unknown} error - Untrusted child, stream or host failure.
     * @returns {void} Marks failure and stops the owned native child.
     * @complexity O(1) time and space.
     * @example fail(new Error('private detail')); // private detail is discarded
     */
    function fail(error) {
      if (settled) return;
      void error;
      failed = true;
      abandonLog();
      stop('SIGTERM');
    }

    /**
     * Forwards host termination without changing the cleanup budget.
     * @returns {void} Requests bounded native termination.
     * @complexity O(1) time and space.
     * @example terminate(); // forwards SIGTERM
     */
    function terminate() {
      failed = true;
      stop('SIGTERM');
    }

    /**
     * Forwards host interruption without changing the cleanup budget.
     * @returns {void} Requests bounded native interruption.
     * @complexity O(1) time and space.
     * @example interrupt(); // forwards SIGINT
     */
    function interrupt() {
      failed = true;
      stop('SIGINT');
    }

    /**
     * Accepts only the remaining bounded log prefix and drains everything else.
     * @param {Buffer} chunk - Raw native stdout or stderr bytes.
     * @returns {void} Enqueues at most the remaining combined byte budget.
     * @complexity O(min(B, R)) copying for chunk bytes B and remaining budget R; total retained copies never exceed 64 KiB.
     * @example copyOutput(Buffer.from('ready\n')); // both native streams share one budget
     */
    function copyOutput(chunk) {
      if (settled || logClosing || accepted === MAX_LOG_BYTES) return;
      if (!Buffer.isBuffer(chunk)) return fail(new TypeError('invalid_output'));
      const length = Math.min(chunk.length, MAX_LOG_BYTES - accepted);
      if (length === 0) return;
      accepted += length;
      pending += 1;
      if (!logTimer) logTimer = setTimeout(() => fail(new Error('log_timeout')), SHUTDOWN_GRACE_MS);
      try {
        // A copy avoids retaining a large discarded tail via a Buffer view.
        log.write(Buffer.from(chunk.subarray(0, length)), (error) => {
          pending -= 1;
          if (error) return fail(error);
          if (pending === 0 && !logClosing) {
            clearTimeout(logTimer);
            logTimer = undefined;
          }
        });
      } catch (error) {
        fail(error);
      }
    }

    /**
     * Records native exit before releasing inherited output streams.
     * @param {number|null} code - Native exit code.
     * @param {NodeJS.Signals|null} signal - Native terminal signal.
     * @returns {void} Bounds pipes held open by descendants after native exit.
     * @complexity O(1) time and space.
     * @example onExit(0, null); // waits briefly for output close
     */
    function onExit(code, signal) {
      if (settled) return;
      childExited = true;
      status = code ?? (signal && constants.signals[signal] ? 128 + constants.signals[signal] : 1);
      clearTimeout(childTimer);
      childTimer = setTimeout(abandonChild, SHUTDOWN_GRACE_MS);
    }

    log.on('error', fail);
    log.once('close', () => {
      logClosed = true;
      clearTimeout(logTimer);
      if (!logClosing) fail(new Error('log_closed'));
      finish();
    });
    signals.on('SIGTERM', terminate);
    signals.on('SIGINT', interrupt);
    signals.on('uncaughtException', fail);
    signals.on('unhandledRejection', fail);
    try {
      child = (dependencies.spawn ?? spawn)(binaryPath, [], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.on('error', fail);
      child.once('exit', onExit);
      child.once('close', (code, signal) => {
        if (settled) return;
        if (!childExited) onExit(code, signal);
        childClosed = true;
        clearTimeout(childTimer);
        closeLog();
      });
      child.stdout.on('error', fail);
      child.stderr.on('error', fail);
      child.stdout.on('data', copyOutput);
      child.stderr.on('data', copyOutput);
    } catch (error) {
      fail(error);
    }
  });
}

module.exports = { runDaemonHost, MAX_LOG_BYTES, SHUTDOWN_GRACE_MS };

if (require.main === module) {
  // This host has no terminal channel: fd 3 is its sole bounded diagnostic sink.
  // Explicit exit also bounds handles left behind by failed kernel cleanup.
  runDaemonHost(process.argv.length === 3 ? process.argv[2] : '').then(
    (code) => process.exit(code),
    () => process.exit(1)
  );
}

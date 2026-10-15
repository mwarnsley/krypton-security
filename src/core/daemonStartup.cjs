const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { dispatchNativeControl, NativeControlError } = require('./processIsolation.cjs');

const STARTUP_BUDGET_MS = 3000;
const POLL_MS = 100;
const HOST_STOP_MS = 4000;

/** Stable source-daemon diagnostics contain no filesystem paths or subprocess output. */
class DaemonStartupError extends Error {
  /**
   * Creates a redacted startup failure.
   * @param {import('./daemonStartup.cjs').DaemonStartupErrorCode} code Failure category.
   * @returns {DaemonStartupError} Typed failure.
   * @complexity O(1) time and space.
   * @example new DaemonStartupError('binary_missing');
   */
  constructor(code) {
    super(code);
    this.code = code;
    this.name = 'DaemonStartupError';
  }
}

/**
 * Recognizes absent discovery, refused sockets and disconnected transports for lock-guarded startup.
 * @param {unknown} error Transport failure.
 * @returns {boolean} False for authentication, malformed data, timeout and unknown failures.
 * @complexity O(1) time and space.
 * @example unavailable(new NativeControlError('unavailable', 'Unavailable')); // true
 */
function unavailable(error) {
  return (
    error instanceof NativeControlError &&
    (error.code === 'unavailable' || error.code === 'disconnected')
  );
}

/**
 * Selects an existing owner-controlled executable; never compiles inside client startup.
 * @param {string} root Canonical checkout root.
 * @param {object} deps Filesystem and optional Cargo target-directory boundaries.
 * @returns {Promise<string>} Canonical binary path, or a typed failure.
 * @complexity O(L) path processing and fixed-count filesystem calls, O(L) space.
 * @example await resolveBinary('/checkout', { fs, uid: process.getuid() });
 */
async function resolveBinary(root, deps) {
  const targets = [
    ...new Set([
      ...(deps.targetDirectory ? [path.resolve(root, deps.targetDirectory)] : []),
      path.join(root, 'target'),
      path.join(root, 'src/core-native/target'),
    ]),
  ];
  for (const profile of ['release', 'debug']) {
    for (const target of targets) {
      try {
        const binary = await deps.fs.realpath(path.join(target, profile, 'krypton-core-native'));
        const stat = await deps.fs.stat(binary);
        if (!stat.isFile() || stat.uid !== deps.uid || (stat.mode & 0o022) !== 0)
          throw new DaemonStartupError('binary_unsafe');
        await deps.fs.access(binary, constants.X_OK);
        return binary;
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') continue;
        throw error instanceof DaemonStartupError ? error : new DaemonStartupError('binary_unsafe');
      }
    }
  }
  throw new DaemonStartupError('binary_missing');
}

/**
 * Atomically publishes a fresh private log inode after validating existing state.
 * The named log belongs to the latest startup attempt. Earlier hosts retain
 * their own bounded, unlinked inodes, so concurrent starters cannot overwrite
 * each other's output. Publication does not promise crash-durable log storage.
 * @param {string} root Canonical project root containing .krypton.
 * @param {object} deps Filesystem and current-user boundaries.
 * @returns {Promise<import('node:fs/promises').FileHandle>} Owned handle; caller must close.
 * @complexity O(L) path processing, fixed-count filesystem calls, O(L) space.
 * @example const log = await openLog('/checkout', { fs, uid: process.getuid() });
 */
async function openLog(root, deps) {
  let handle;
  let stagedPath;
  let staged = false;
  try {
    for (const [directory, mask] of [
      [path.join(root, '.krypton'), 0o022],
      [path.join(root, '.krypton/logs'), 0o077],
    ]) {
      try {
        await deps.fs.mkdir(directory, { mode: 0o700 });
      } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'EEXIST') throw error;
      }
      const stat = await deps.fs.lstat(directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        stat.uid !== deps.uid ||
        (stat.mode & mask) !== 0
      )
        throw new DaemonStartupError('log_unavailable');
    }
    const logPath = path.join(root, '.krypton/logs/daemon.log');
    try {
      const existing = await deps.fs.lstat(logPath);
      if (
        !existing.isFile() ||
        existing.isSymbolicLink() ||
        existing.uid !== deps.uid ||
        (existing.mode & 0o077) !== 0 ||
        existing.nlink !== 1
      )
        throw new DaemonStartupError('log_unavailable');
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
    }
    stagedPath = path.join(root, '.krypton/logs', `.daemon-${randomUUID()}.tmp`);
    handle = await deps.fs.open(
      stagedPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600
    );
    staged = true;
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== deps.uid || (stat.mode & 0o077) !== 0 || stat.nlink !== 1)
      throw new DaemonStartupError('log_unavailable');
    await deps.fs.rename(stagedPath, logPath);
    staged = false;
    return handle;
  } catch (error) {
    let cleanupFailed = false;
    try {
      await handle?.close();
    } catch (closeError) {
      void closeError;
      cleanupFailed = true;
    }
    if (staged) {
      try {
        await deps.fs.unlink(stagedPath);
      } catch (unlinkError) {
        // An already removed staging name needs no further cleanup.
        if (!unlinkError || typeof unlinkError !== 'object' || unlinkError.code !== 'ENOENT')
          cleanupFailed = true;
      }
    }
    if (cleanupFailed) throw new DaemonStartupError('cleanup_failed');
    throw error instanceof DaemonStartupError ? error : new DaemonStartupError('log_unavailable');
  }
}

/**
 * Stops only the owned host, which forwards shutdown and reaps its native child.
 * @param {import('node:child_process').ChildProcess} host Owned host process.
 * @param {Promise<void>} closed Observed host close.
 * @param {object} deps Timer boundaries.
 * @returns {Promise<void>} Rejects if shutdown cannot be confirmed; never signals a discovered PID.
 * @complexity O(1) time and space, bounded four-second wait excluding OS stalls.
 * @example await stopHost(host, closed, { setTimer: setTimeout, clearTimer: clearTimeout });
 */
async function stopHost(host, closed, deps) {
  let timer;
  try {
    if (host.exitCode === null && host.signalCode === null && host.pid !== undefined) {
      if (!host.kill('SIGTERM')) throw new DaemonStartupError('cleanup_failed');
    }
    await Promise.race([
      closed,
      new Promise((resolve, reject) => {
        timer = deps.setTimer(() => reject(new DaemonStartupError('cleanup_failed')), HOST_STOP_MS);
      }),
    ]);
  } catch (error) {
    void error;
    throw new DaemonStartupError('cleanup_failed');
  } finally {
    deps.clearTimer(timer);
  }
}

/**
 * Reuses authenticated healthy service or starts a detached, bounded-log native host.
 * Startup probes are read-only and retry only absent/refused/disconnected endpoints. Native startup.lock
 * arbitrates simultaneous clients; a losing host may exit while the winning daemon becomes ready.
 * Only the lock-holding native starter may remove a refused orphan socket; JS never unlinks it.
 * The three-second readiness deadline is separate from each 1500 ms transport deadline.
 * Filesystem/kernel calls cannot be forcibly cancelled. This service persists across client exits;
 * MCP children retain the supervisor's existing exit/unregister lifecycle.
 * @param {import('./supervisor.cjs').SupervisorWorkspace} workspace Canonical checkout and runtime roots.
 * @param {import('./daemonStartup.cjs').DaemonStartupDependencies} dependencies Injectable host effects.
 * @returns {Promise<void>} Resolves only after healthy authenticated IPC; otherwise fails closed.
 * @complexity O(L) setup plus at most 30 bounded probes; O(L) retained space.
 * @example await ensureNativeDaemon(workspace); // no agent starts before health succeeds
 */
async function ensureNativeDaemon(workspace, dependencies = {}) {
  const deps = {
    fs,
    spawn,
    dispatch: dispatchNativeControl,
    uid: process.getuid?.(),
    targetDirectory: process.env.CARGO_TARGET_DIR,
    signals: process,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    ...dependencies,
  };
  /**
   * Checks the authenticated selected workspace without mutating enforcement state.
   * @returns {Promise<void>} Rejects unhealthy or unreachable native service.
   * @complexity O(L) bounded IPC payload processing and O(L) space.
   * @example await probe(); // no permission to launch until this resolves
   */
  const probe = async () => {
    if (deps.signal?.aborted) throw new DaemonStartupError('startup_cancelled');
    const health = await deps.dispatch({ type: 'health' }, workspace.projectRoot);
    if (deps.signal?.aborted) throw new DaemonStartupError('startup_cancelled');
    if (health.ok !== true || health.health?.status !== 'healthy')
      throw new DaemonStartupError('daemon_unhealthy');
  };
  try {
    await probe();
    return;
  } catch (error) {
    if (!unavailable(error)) throw error;
  }
  const binary = await resolveBinary(workspace.repositoryRoot, deps);
  const log = await openLog(workspace.projectRoot, deps);
  let host;
  let closed;
  let deadlineTimer;
  let pollTimer;
  let cancel;
  let cancellationError;
  let ready = false;
  let failure;
  const cancellation = new Promise((resolve) => {
    cancel = resolve;
  });
  /**
   * Cancels readiness on parent shutdown without extending any timer.
   * @returns {void} Settles the shared cancellation signal.
   * @complexity O(1) time and space.
   * @example cancelled(); // pending readiness rejects
   */
  const cancelled = () => {
    cancellationError = new DaemonStartupError('startup_cancelled');
    cancel(cancellationError);
  };
  try {
    if (deps.signal?.aborted) throw new DaemonStartupError('startup_cancelled');
    host = deps.spawn(process.execPath, [path.join(__dirname, 'daemonHost.cjs'), binary], {
      cwd: workspace.repositoryRoot,
      detached: true,
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore', log.fd],
    });
    closed = new Promise((resolve) => {
      host.once('close', resolve);
      // Retain ownership of late errors even after the host is unreferenced.
      host.on('error', () => {
        cancellationError = new DaemonStartupError('startup_failed');
        cancel(cancellationError);
      });
    });
    deps.signals.on('SIGINT', cancelled);
    deps.signals.on('SIGTERM', cancelled);
    deps.signal?.addEventListener('abort', cancelled, { once: true });
    deadlineTimer = deps.setTimer(() => {
      cancellationError = new DaemonStartupError('startup_timeout');
      cancel(cancellationError);
    }, STARTUP_BUDGET_MS);
    /**
     * Races one bounded probe or delay, retaining ownership of late rejections.
     * @param {Promise<unknown>} operation Pending read-only work.
     * @returns {Promise<unknown>} Result or shared cancellation error.
     * @complexity O(1) time and space per race; at most 30 races retained.
     * @example await wait(probe());
     */
    const wait = (operation) =>
      Promise.race([
        operation,
        cancellation.then((error) => {
          throw error;
        }),
      ]);
    for (let attempt = 0; attempt < STARTUP_BUDGET_MS / POLL_MS; attempt++) {
      if (cancellationError) throw cancellationError;
      try {
        await wait(probe());
        if (cancellationError) throw cancellationError;
        ready = true;
        break;
      } catch (error) {
        if (!unavailable(error)) throw error;
      }
      await wait(
        new Promise((resolve) => {
          pollTimer = deps.setTimer(resolve, POLL_MS);
        })
      );
      deps.clearTimer(pollTimer);
    }
    if (!ready) throw new DaemonStartupError('startup_timeout');
  } catch (error) {
    failure =
      error instanceof NativeControlError || error instanceof DaemonStartupError
        ? error
        : new DaemonStartupError('startup_failed');
  } finally {
    deps.clearTimer(deadlineTimer);
    deps.clearTimer(pollTimer);
    deps.signals.removeListener('SIGINT', cancelled);
    deps.signals.removeListener('SIGTERM', cancelled);
    deps.signal?.removeEventListener('abort', cancelled);
    try {
      await log.close();
    } catch (error) {
      void error;
      failure = new DaemonStartupError('cleanup_failed');
    }
    if (host) {
      try {
        if (failure) await stopHost(host, closed, deps);
      } finally {
        host.unref();
      }
    }
  }
  if (failure) throw failure;
}

module.exports = { ensureNativeDaemon, DaemonStartupError, STARTUP_BUDGET_MS };

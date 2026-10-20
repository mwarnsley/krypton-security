#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { PassThrough } = require('node:stream');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { spawn } = require('node:child_process');
const { runCli } = require('../cli/runtime.cjs');
const {
  NativeControlError,
  dispatchNativeControl,
  discoverNativeEndpoint,
} = require('../core/processIsolation.cjs');

const STARTUP_MS = 5000;
const STARTUP_ATTEMPTS = 20;
const RETRY_MS = 100;
const CLEANUP_MS = 2000;
const SERVICE_SETTLEMENT_MS = 1500;
const children = new WeakMap();

/** Errors contain stable categories only: no paths, native output, or arbitrary causes. */
class LauncherError extends Error {
  /** @param {import('./launch_mcpb.cjs').LauncherErrorCode} code Stable redacted category. */
  constructor(code) {
    super(code);
    this.name = 'LauncherError';
    this.code = code;
  }
}

/** Normalizes unknown thrown values without retaining untrusted exception text or causes. */
function launcherFailure(error, code) {
  return error instanceof LauncherError ? error : new LauncherError(code);
}

/** Cancellation clears an owned delay without leaving a timer or rejected promise behind. */
function delay(milliseconds, signal) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted) finish();
  });
}

/** Observes only a supplied ChildProcess; discovered PIDs are never signaling authority. */
function observe(child) {
  const existing = children.get(child);
  if (existing) return existing;
  const state = { exited: child.exitCode !== null || child.signalCode !== null, failed: false };
  let stop;
  let reap;
  state.stopped = new Promise((resolve) => {
    stop = resolve;
  });
  state.reaped = new Promise((resolve) => {
    reap = resolve;
  });
  const exited = () => {
    state.exited = true;
    reap();
    stop(new LauncherError('native_exited'));
  };
  const failed = () => {
    state.failed = true;
    // A failed spawn has no process to signal; Node still emits close afterward.
    if (child.pid === undefined) exited();
    stop(new LauncherError('native_failed'));
  };
  const closed = () => {
    exited();
    child.off('error', failed);
    child.off('exit', exited);
  };
  children.set(child, state);
  if (state.exited) exited();
  else {
    child.on('error', failed);
    child.once('exit', exited);
    child.once('close', closed);
  }
  return state;
}

/**
 * Requires authenticated healthy readiness under one five-second absolute deadline.
 * Stale discovery waits for owned-child publication, at most twenty attempts.
 * Actual transport failures retry only when typed unavailable/disconnected.
 * Real dispatches retain their own 1500 ms deadline; OS stalls are not real-time.
 * @param {string} runtimeHome Explicit directory containing private discovery state.
 * @param {import('node:child_process').ChildProcess} child The exact owned daemon.
 * @param {import('./launch_mcpb.cjs').ReadinessDependencies} dependencies Test boundaries.
 * @returns {Promise<void>} Rejects with a redacted error on readiness uncertainty.
 */
async function waitForNativeReady(runtimeHome, child, dependencies = {}) {
  return nativeReady(runtimeHome, child, dependencies);
}

/** Internal readiness cancellation ends probes when the owning session begins cleanup. */
async function nativeReady(runtimeHome, child, dependencies, signal) {
  const state = observe(child);
  const ownedPid = child.pid;
  if (!Number.isSafeInteger(ownedPid) || ownedPid <= 0) throw new LauncherError('native_failed');
  const now = dependencies.now ?? (() => performance.now());
  const dispatch = dependencies.dispatch ?? dispatchNativeControl;
  const discover = dependencies.discover ?? discoverNativeEndpoint;
  const pause = dependencies.delay ?? delay;
  let mismatchedDiscovery = false;
  const deadlineAt = now() + STARTUP_MS;
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new LauncherError('readiness_timeout')), STARTUP_MS);
  });
  let cancel;
  const cancelled = new Promise((_, reject) => {
    cancel = () => reject(new LauncherError('readiness_cancelled'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
  const stopped = Promise.race([
    state.stopped.then((error) => {
      throw error;
    }),
    cancelled,
  ]);
  // Own rejection immediately, including failures before the first probe is awaited.
  void stopped.catch(() => undefined);
  // Private metadata ties readiness to the exact still-live spawned child. Its PID
  // is comparison evidence only; it never becomes authority to signal a process.
  const checkDiscovery = async () => {
    mismatchedDiscovery = false;
    const endpoint = await Promise.race([discover(runtimeHome), stopped, deadline]);
    if (now() >= deadlineAt) throw new LauncherError('readiness_timeout');
    if (state.exited || state.failed || child.pid !== ownedPid)
      throw new LauncherError('native_exited');
    if (!Number.isSafeInteger(endpoint?.pid) || endpoint.pid <= 0)
      throw new LauncherError('readiness_failed');
    // Native startup replaces a prior daemon's record late in start_ipc. A
    // different valid PID is non-ready, not evidence that this startup failed.
    mismatchedDiscovery = endpoint.pid !== ownedPid;
    return !mismatchedDiscovery;
  };
  try {
    for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
      if (state.exited || state.failed) throw new LauncherError('native_exited');
      if (now() >= deadlineAt) throw new LauncherError('readiness_timeout');
      try {
        if (await checkDiscovery()) {
          const response = await Promise.race([
            dispatch({ type: 'health' }, runtimeHome),
            stopped,
            deadline,
          ]);
          if (now() >= deadlineAt) throw new LauncherError('readiness_timeout');
          if (state.exited || state.failed) throw new LauncherError('native_exited');
          if (
            response?.ok !== true ||
            response.code !== 'ready' ||
            response.health?.status !== 'healthy'
          )
            throw new LauncherError('native_unhealthy');
          if (await checkDiscovery()) return;
        }
      } catch (error) {
        if (error instanceof LauncherError) throw error;
        if (
          !(error instanceof NativeControlError) ||
          !['unavailable', 'disconnected'].includes(error.code)
        )
          throw new LauncherError('readiness_failed');
      }
      if (attempt + 1 < STARTUP_ATTEMPTS) {
        const remaining = deadlineAt - now();
        if (remaining <= 0) throw new LauncherError('readiness_timeout');
        await Promise.race([
          pause(Math.min(RETRY_MS, remaining), controller.signal),
          stopped,
          deadline,
        ]);
      }
    }
    throw new LauncherError(mismatchedDiscovery ? 'native_busy' : 'readiness_timeout');
  } catch (error) {
    throw error instanceof LauncherError ? error : new LauncherError('readiness_failed');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}

/** Waits for an exit event while cancelling the losing bounded delay. */
async function waitForExit(state, pause) {
  if (state.exited) return;
  const controller = new AbortController();
  try {
    await Promise.race([state.reaped, pause(CLEANUP_MS, controller.signal)]);
  } finally {
    controller.abort();
  }
}

/**
 * Shares one cleanup promise per child, with TERM then KILL and two seconds per wait.
 * Node reaps at exit; already-exited children are never signaled.
 * @param {import('node:child_process').ChildProcess} child Exact owned daemon.
 * @param {import('./launch_mcpb.cjs').CleanupDependencies} dependencies Optional bounded delay.
 * @returns {Promise<void>} Rejects with cleanup_failed if signaling or bounded reaping fails.
 */
function terminateOwnedDaemon(child, dependencies = {}) {
  const state = observe(child);
  if (state.cleanup) return state.cleanup;
  state.cleanup = Promise.resolve().then(async () => {
    let failure;
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
      // Failed spawn has no process authority; own its asynchronous error/close only.
      await waitForExit(state, dependencies.delay ?? delay);
      if (!state.exited) throw new LauncherError('cleanup_failed');
      return;
    }
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      if (state.exited) break;
      try {
        if (!child.kill(signal)) failure = new LauncherError('cleanup_failed');
      } catch (error) {
        // Continue bounded escalation, without retaining arbitrary OS errors.
        failure = launcherFailure(error, 'cleanup_failed');
      }
      try {
        await waitForExit(state, dependencies.delay ?? delay);
      } catch (error) {
        failure = launcherFailure(error, 'cleanup_failed');
      }
    }
    if (failure || state.failed || !state.exited) throw new LauncherError('cleanup_failed');
  });
  return state.cleanup;
}

/** Owns a cancelled service's settlement; cancellation rejection is expected, a stall is not. */
async function settleCancelledService(service) {
  const controller = new AbortController();
  try {
    const settled = await Promise.race([
      service.then(
        () => true,
        () => true
      ),
      delay(SERVICE_SETTLEMENT_MS, controller.signal).then(() => false),
    ]);
    if (!settled) throw new LauncherError('service_timeout');
  } finally {
    controller.abort();
  }
}

/** Owns startup, service races and cleanup; terminal failure uses only this captured child. */
async function runOwned(options, dependencies, owned) {
  let child;
  let code = 0;
  let signaled = false;
  let failure;
  let stopping = false;
  let service;
  let serviceFinished = false;
  let inputClosedObserved = false;
  let inputEnded = false;
  let outputClosedObserved = false;
  let stop;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  // Host stdin may be event-only (Electron utilityProcess), not an async iterable.
  const adaptedInput = new PassThrough({ highWaterMark: 16384 });
  const startup = new AbortController();
  const interrupted = new Promise((resolve) => {
    stop = resolve;
  });
  const signal = () => {
    signaled = true;
    stop(0);
  };
  const streamFailed = (error) => {
    failure = launcherFailure(error, 'server_failed');
    stop(1);
  };
  const inputClosed = () => {
    inputClosedObserved = true;
    if (!stopping) {
      // Clean EOF belongs to serve: it may still be flushing a bounded response.
      if (!inputEnded && !input.readableEnded) streamFailed(new LauncherError('server_failed'));
    }
  };
  const outputClosed = () => {
    outputClosedObserved = true;
    if (!stopping) streamFailed(new LauncherError('server_failed'));
  };
  const inputData = (chunk) => {
    try {
      if (!adaptedInput.write(chunk)) input.pause();
    } catch (error) {
      streamFailed(error);
    }
  };
  const inputEnd = () => {
    inputEnded = true;
    adaptedInput.end();
  };
  const inputDrain = () => {
    try {
      if (!stopping && !inputEnded) input.resume();
    } catch (error) {
      streamFailed(error);
    }
  };
  adaptedInput.on('error', streamFailed);
  adaptedInput.once('close', () => adaptedInput.off('error', streamFailed));
  adaptedInput.on('drain', inputDrain);
  input.on('end', inputEnd);
  input.on('data', inputData);
  process.on('SIGINT', signal);
  process.on('SIGTERM', signal);
  input.on('error', streamFailed);
  input.on('close', inputClosed);
  output.on('error', streamFailed);
  output.on('close', outputClosed);
  // A caller may supply a stream that already emitted its clean EOF.
  if (input.readableEnded) inputEnd();
  try {
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    if (platform !== 'darwin' || !['arm64', 'x64'].includes(arch))
      throw new LauncherError('unsupported_platform');
    // Optional installed dependencies load inside the redacted terminal failure boundary.
    const prepare =
      dependencies.prepareRuntime ?? require('./mcpb_runtime.cjs').prepareStandaloneRuntime;
    const prepared = await prepare({
      bundleRoot: options.bundleRoot ?? path.resolve(__dirname, '../..'),
      version: require('../../package.json').version,
      platform,
      arch,
      homeDirectory: options.homeDirectory ?? os.homedir(),
      ...(options.nativeBinaryPath === undefined
        ? {}
        : { nativeBinaryPath: options.nativeBinaryPath }),
      configuredWorkspace:
        options.configuredWorkspace ?? process.env.KRYPTON_PROTECTED_WORKSPACE_ROOT,
    });
    if (!signaled) {
      if (failure || (input.destroyed && !inputEnded) || output.destroyed)
        throw new LauncherError('server_failed');
      child = (dependencies.spawn ?? spawn)(
        prepared.daemonPath,
        ['--standalone-config', prepared.configPath],
        { shell: false, stdio: ['ignore', 'ignore', 'ignore'] }
      );
      owned(child);
      const state = observe(child);
      const readinessPromise = nativeReady(
        prepared.runtimeHome,
        child,
        dependencies,
        startup.signal
      );
      void readinessPromise.catch(() => undefined);
      const readiness = await Promise.race([
        readinessPromise.then(() => true),
        interrupted.then((result) => {
          code = result;
          return false;
        }),
      ]);
      if (readiness && !signaled) {
        service = Promise.resolve()
          .then(() =>
            (dependencies.serve ?? require('../core/mcp/server.cjs').serve)(adaptedInput, output, {
              runtimeHome: prepared.runtimeHome,
            })
          )
          .then(
            () => {
              serviceFinished = true;
              return 0;
            },
            (error) => {
              serviceFinished = true;
              throw launcherFailure(error, 'server_failed');
            }
          );
        code = await Promise.race([service, state.stopped.then(() => 1), interrupted]);
      }
    }
  } catch (error) {
    // runCli emits a fixed diagnostic, never raw errors or native responses.
    failure = launcherFailure(error, 'operation_failed');
  } finally {
    stopping = true;
    startup.abort();
    input.off('data', inputData);
    input.off('end', inputEnd);
    adaptedInput.off('drain', inputDrain);
    const cancelService = service && !serviceFinished;
    // Destroy both sides on forced stop so an in-flight write rejects and buffered
    // requests cannot produce more output. Normal EOF reaches here only after serve settles.
    for (const stream of cancelService ? [adaptedInput, input, output] : [adaptedInput, input]) {
      try {
        stream.destroy();
      } catch (error) {
        failure = launcherFailure(error, 'server_failed');
      }
    }
    const serviceCleanup = cancelService
      ? settleCancelledService(service).catch((error) => {
          failure = launcherFailure(error, 'service_timeout');
        })
      : Promise.resolve();
    const daemonCleanup = child
      ? terminateOwnedDaemon(child, dependencies).catch((error) => {
          failure = launcherFailure(error, 'cleanup_failed');
        })
      : Promise.resolve();
    await Promise.all([serviceCleanup, daemonCleanup]);
    process.off('SIGINT', signal);
    process.off('SIGTERM', signal);
    input.off('close', inputClosed);
    output.off('close', outputClosed);
    // Stream callbacks may arrive after destruction. Keep failure ownership until close.
    for (const [stream, closed] of [
      [input, inputClosedObserved],
      [output, outputClosedObserved],
    ]) {
      // Writable.closed can become true before queued error/close events are delivered.
      if (closed) stream.off('error', streamFailed);
      else stream.once('close', () => stream.off('error', streamFailed));
    }
  }
  return failure ? 1 : code;
}

/**
 * Runs installed MCP in-process and owns only its directly spawned native daemon.
 * @param {import('./launch_mcpb.cjs').LauncherOptions} options Installed paths and host streams.
 * @param {import('./launch_mcpb.cjs').LauncherDependencies} dependencies Injectable OS boundaries.
 * @returns {Promise<number>} 0 for EOF, clean completion or signal; 1 for operational failure.
 */
async function runStandaloneMcpb(options = {}, dependencies = {}) {
  return runOwned(options, dependencies, () => undefined);
}

/** Bounded usage output is owned by runCli, including stream failure. */
function invalidUsage() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new LauncherError('output_timeout')), 1500);
    try {
      process.stderr.write('[KRYPTON] invalid_usage; launcher accepts no arguments.\n', (error) => {
        clearTimeout(timer);
        if (error) reject(new LauncherError('output_failed'));
        else resolve(2);
      });
    } catch (error) {
      clearTimeout(timer);
      reject(new LauncherError(error instanceof Error ? 'output_failed' : 'unexpected_failure'));
    }
  });
}

/** Terminal entry shared by MCPB hosts and the bare-run CLI, including exact-child fallback. */
function launchStandaloneMcpb(options = {}, argv = []) {
  let child;
  let terminalFailed = false;
  return runCli(
    async (argv) => {
      if (argv.length !== 0) return invalidUsage();
      const code = await runOwned(options, {}, (spawned) => {
        child = spawned;
      });
      if (code !== 0 && !terminalFailed) throw new LauncherError('operation_failed');
      return code;
    },
    argv,
    () => {
      // Streams may be broken: synchronous exact-child fallback with no recursive logging.
      terminalFailed = true;
      process.stdin.destroy();
      process.stdout.destroy();
      if (child && child.exitCode === null && child.signalCode === null && child.pid !== undefined)
        child.kill('SIGKILL');
    }
  );
}

/** Host shims may require the entry module; canonical argv identity excludes ordinary imports. */
function isEntryPoint() {
  if (require.main === module) return true;
  try {
    return (
      Boolean(process.argv[1]) &&
      fs.realpathSync.native(process.argv[1]) === fs.realpathSync.native(__filename)
    );
  } catch (error) {
    // Missing/unresolvable argv is not authority to auto-launch an imported module.
    void error;
    return false;
  }
}

module.exports = {
  LauncherError,
  runStandaloneMcpb,
  waitForNativeReady,
  terminateOwnedDaemon,
  launchStandaloneMcpb,
};
if (isEntryPoint()) void launchStandaloneMcpb({}, process.argv.slice(2));

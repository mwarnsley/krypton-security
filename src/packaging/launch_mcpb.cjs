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
// Attached sessions probe the shared daemon once per interval, one request in flight.
const MONITOR_MS = 1000;
// Owner-loss recovery attempts per loss event before the attached session fails closed.
const TAKEOVER_ROUNDS = 2;
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

/** Healthy authenticated readiness, the only state an owner or attached session may serve. */
function healthyResponse(response) {
  return (
    response?.ok === true && response.code === 'ready' && response.health?.status === 'healthy'
  );
}

/**
 * Requires a healthy daemon owned by another launch of this same private runtime home, under
 * one five-second absolute deadline. Authentication uses only the private discovery record and
 * capability; the discovered PID is compared before and after health and is never signaled.
 * Retries absent/refused/disconnected transport and an owner whose watcher is still starting.
 * One `unauthorized` reply is tolerated only if discovery is then republished with another PID
 * (an owner replacing its capability); stable discovery that rejects the capability fails closed.
 * @param {string} runtimeHome Explicit directory containing private discovery state.
 * @param {import('./launch_mcpb.cjs').ReadinessDependencies} dependencies Test boundaries.
 * @returns {Promise<void>} Rejects native_unreachable when no daemon answered before the deadline.
 * @complexity O(A·L) for at most twenty attempts A over bounded discovery/response length L.
 * @example await waitForNativeAttach('/private/runtime-home'); // healthy shared daemon
 */
async function waitForNativeAttach(runtimeHome, dependencies = {}) {
  return nativeAttach(runtimeHome, dependencies);
}

/** Internal attach readiness; cancellation ends probes when the owning session begins cleanup. */
async function nativeAttach(runtimeHome, dependencies, signal) {
  const now = dependencies.now ?? (() => performance.now());
  const dispatch = dependencies.dispatch ?? dispatchNativeControl;
  const discover = dependencies.discover ?? discoverNativeEndpoint;
  const pause = dependencies.delay ?? delay;
  const deadlineAt = now() + STARTUP_MS;
  const controller = new AbortController();
  let reached = false;
  let unauthorizedPid;
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
  void cancelled.catch(() => undefined);
  const discoveredPid = async () => {
    const endpoint = await Promise.race([discover(runtimeHome), cancelled, deadline]);
    if (now() >= deadlineAt) throw new LauncherError('readiness_timeout');
    if (!Number.isSafeInteger(endpoint?.pid) || endpoint.pid <= 0)
      throw new LauncherError('readiness_failed');
    return endpoint.pid;
  };
  try {
    for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
      if (now() >= deadlineAt) throw new LauncherError('readiness_timeout');
      try {
        const before = await discoveredPid();
        if (before === unauthorizedPid) throw new LauncherError('native_unauthorized');
        const response = await Promise.race([
          dispatch({ type: 'health' }, runtimeHome),
          cancelled,
          deadline,
        ]);
        if (now() >= deadlineAt) throw new LauncherError('readiness_timeout');
        reached = true;
        // A changed record means the probe raced a republication: retry against the new owner.
        if ((await discoveredPid()) === before) {
          if (healthyResponse(response)) return;
          if (response?.ok === false && response.code === 'unauthorized') {
            if (unauthorizedPid !== undefined) throw new LauncherError('native_unauthorized');
            unauthorizedPid = before;
          } else if (
            response?.ok !== true ||
            response.code !== 'degraded' ||
            response.health?.watcher !== 'starting'
          )
            throw new LauncherError('native_unhealthy');
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
          cancelled,
          deadline,
        ]);
      }
    }
    throw new LauncherError(
      unauthorizedPid === undefined ? 'readiness_timeout' : 'native_unauthorized'
    );
  } catch (error) {
    const failure = error instanceof LauncherError ? error : new LauncherError('readiness_failed');
    // Nothing answered: the owner is absent, which an owner-loss takeover may retry.
    throw failure.code === 'readiness_timeout' && !reached
      ? new LauncherError('native_unreachable')
      : failure;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}

/**
 * Long-lived attached-session supervision with one authenticated health probe in flight per
 * second. Resolves `lost` when the shared daemon is unreachable or rejects the current private
 * capability (its owner exited or republished), and `cancelled` when the session aborts the
 * signal. A probe timeout keeps serving because every tool call already fails closed on its own
 * 1500 ms deadline; degraded health keeps serving with the same per-call receipts as an owner.
 * Any other transport or response failure rejects native_unhealthy. Never inspects or signals
 * the owner process; a probe socket cancelled at shutdown still closes within its own deadline.
 * @param {string} runtimeHome Explicit directory containing private discovery state.
 * @param {AbortSignal} signal Session shutdown signal.
 * @param {import('./launch_mcpb.cjs').ReadinessDependencies} dependencies Test boundaries.
 * @returns {Promise<'lost'|'cancelled'>} Loss or shutdown; rejects with a redacted category.
 * @complexity O(L) per probe for bounded response length L; O(1) retained state.
 * @example await watchAttachedDaemon('/private/runtime-home', controller.signal); // 'lost'
 */
async function watchAttachedDaemon(runtimeHome, signal, dependencies = {}) {
  const dispatch = dependencies.dispatch ?? dispatchNativeControl;
  const pause = dependencies.delay ?? delay;
  const stopped = Symbol('stopped');
  let cancel;
  const cancelled = new Promise((resolve) => {
    cancel = () => resolve(stopped);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try {
    while (!signal.aborted) {
      await Promise.race([pause(MONITOR_MS, signal), cancelled]);
      if (signal.aborted) break;
      let response;
      try {
        response = await Promise.race([dispatch({ type: 'health' }, runtimeHome), cancelled]);
      } catch (error) {
        if (error instanceof NativeControlError) {
          if (['unavailable', 'disconnected'].includes(error.code)) return 'lost';
          if (error.code === 'timeout') continue;
        }
        throw new LauncherError('native_unhealthy');
      }
      if (response === stopped) break;
      if (response?.ok === false && response.code === 'unauthorized') return 'lost';
      if (response?.ok !== true) throw new LauncherError('native_unhealthy');
    }
    return 'cancelled';
  } finally {
    signal.removeEventListener('abort', cancel);
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

/**
 * Synchronous last resort for a host that calls process.exit before async cleanup settles
 * (Claude Desktop's built-in Node exits on SIGTERM ahead of the launcher's own handler).
 * Signals only the exact still-live owned ChildProcess; discovered PIDs are never authority.
 * @param {import('node:child_process').ChildProcess} child Exact owned daemon.
 * @returns {void} Sets a failing exit status when the final signal cannot be delivered.
 */
function killOwnedOnExit(child) {
  if (observe(child).exited || child.exitCode !== null || child.signalCode !== null) return;
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return;
  try {
    if (!child.kill('SIGKILL')) process.exitCode = 1;
  } catch (error) {
    // Exit listeners cannot await or safely log; record the failure in the final status only.
    void error;
    process.exitCode = 1;
  }
}

/**
 * Elects this launch as the native owner, or attaches without ownership when another launch of
 * the same workspace already holds the native instance and startup locks. The spawned child is
 * the only signaling authority: a losing child is reaped before attaching, and the shared daemon
 * is never signaled. A child that fails to spawn is not an election loss and stays fatal.
 * @param {import('./mcpb_runtime.cjs').StandaloneRuntimePaths} prepared Validated private paths.
 * @param {import('./launch_mcpb.cjs').LauncherDependencies} dependencies Injectable OS boundaries.
 * @param {(child: import('node:child_process').ChildProcess | undefined) => void} adopt Records the
 * exact current owned child; receives undefined only after the losing child was reaped.
 * @param {AbortSignal} signal Session shutdown signal.
 * @returns {Promise<void>} Resolves owning or attached; rejects with a redacted category.
 */
async function acquireNative(prepared, dependencies, adopt, signal) {
  const child = (dependencies.spawn ?? spawn)(
    prepared.daemonPath,
    ['--standalone-config', prepared.configPath],
    { shell: false, stdio: ['ignore', 'ignore', 'ignore'] }
  );
  adopt(child);
  try {
    await nativeReady(prepared.runtimeHome, child, dependencies, signal);
    return;
  } catch (error) {
    if (!(error instanceof LauncherError) || !['native_exited', 'native_busy'].includes(error.code))
      throw error;
  }
  // Lost the election: release this exact child first; a cleanup failure stays owned by caller.
  await terminateOwnedDaemon(child, dependencies);
  adopt(undefined);
  await nativeAttach(prepared.runtimeHome, dependencies, signal);
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
  let exitFallback;
  let halted = false;
  let stop;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  // Host stdin may be event-only (Electron utilityProcess), not an async iterable.
  const adaptedInput = new PassThrough({ highWaterMark: 16384 });
  const startup = new AbortController();
  const interrupted = new Promise((resolve) => {
    stop = (result) => {
      halted = true;
      resolve(result);
    };
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
      // `child` is the exact current owned daemon, or undefined while attached to a sibling's.
      const adopt = (spawned) => {
        child = spawned;
        owned(spawned);
      };
      exitFallback = () => {
        if (child) killOwnedOnExit(child);
      };
      process.once('exit', exitFallback);
      const halt = () =>
        interrupted.then((result) => {
          code = result;
          return false;
        });
      // Resolves false when a signal or stream failure interrupts election and readiness.
      const acquire = async () => {
        // Never spawn once cleanup has begun: finally has already captured the owned child.
        if (startup.signal.aborted) return false;
        if (halted) return halt();
        const acquiring = acquireNative(prepared, dependencies, adopt, startup.signal);
        void acquiring.catch(() => undefined);
        return Promise.race([acquiring.then(() => true), halt()]);
      };
      // Owner loss: elect a new owner or re-attach. Only an absent daemon retries, bounded.
      const takeOver = async () => {
        for (let round = 1; ; round += 1) {
          try {
            return await acquire();
          } catch (error) {
            if (!(error instanceof LauncherError) || error.code !== 'native_unreachable')
              throw error;
            if (round >= TAKEOVER_ROUNDS) throw new LauncherError('native_owner_lost');
          }
          await (dependencies.delay ?? delay)(RETRY_MS, startup.signal);
        }
      };
      if ((await acquire()) && !signaled) {
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
        const finished = service.then(() => 'finished');
        for (;;) {
          // An owner's daemon exit fails closed as before; attached sessions watch for owner loss.
          const lost = child
            ? observe(child).stopped.then(() => 'exited')
            : watchAttachedDaemon(prepared.runtimeHome, startup.signal, dependencies);
          void lost.catch(() => undefined);
          const outcome = await Promise.race([
            finished,
            lost,
            interrupted.then((result) => {
              code = result;
              return 'interrupted';
            }),
          ]);
          if (outcome === 'finished') code = 0;
          else if (outcome === 'exited') code = 1;
          if (outcome !== 'lost') break;
          // Tool calls during recovery fail closed individually; nothing is retried for them.
          const recovering = takeOver();
          void recovering.catch(() => undefined);
          const recovered = await Promise.race([recovering, finished]);
          if (recovered === 'finished') code = 0;
          if (recovered !== true || signaled) break;
        }
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
    // Bounded cleanup has settled; an abrupt exit can no longer orphan this child.
    if (exitFallback) process.off('exit', exitFallback);
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
 * Runs installed MCP in-process and owns only its directly spawned native daemon. Concurrent
 * launches of one workspace share a single daemon: the native lock winner owns it, and the others
 * attach through private discovery and capability and take over, bounded, if that owner exits.
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

/**
 * Ends a host-loaded process once the launcher settles. Host runners such as Claude Desktop's
 * built-in Node keep their message ports open, so a settled launcher would otherwise idle
 * silently and the host would report a request timeout instead of the failure.
 * @param {Promise<void>} launched Launcher settlement; runCli has assigned process.exitCode.
 * @param {boolean} hostLoaded True only when a host imported this entry instead of running it.
 * @param {(code: number) => void} exit Process exit boundary, injectable for tests.
 * @returns {Promise<void>} Never rejects; a rejected launch exits with status 1.
 */
function settleHostEntry(launched, hostLoaded, exit = (code) => process.exit(code)) {
  const finish = () => {
    if (!hostLoaded) return;
    const status = process.exitCode;
    exit(status === undefined ? 0 : Number.isInteger(status) ? Number(status) : 1);
  };
  return Promise.resolve(launched).then(finish, (error) => {
    // runCli never rejects; an unexpected rejection still fails closed without logging again.
    void error;
    process.exitCode = 1;
    finish();
  });
}

module.exports = {
  LauncherError,
  runStandaloneMcpb,
  waitForNativeReady,
  waitForNativeAttach,
  watchAttachedDaemon,
  terminateOwnedDaemon,
  launchStandaloneMcpb,
  settleHostEntry,
};
if (isEntryPoint())
  void settleHostEntry(launchStandaloneMcpb({}, process.argv.slice(2)), require.main !== module);

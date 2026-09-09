const fs = require('node:fs');
const childProcess = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const util = require('node:util');
const { randomUUID } = require('node:crypto');

const PROJECT_ROOT = process.cwd();
const NATIVE_PROTOCOL_VERSION = 1;
const NATIVE_RESPONSE_MAX_BYTES = 16 * 1024;
const NATIVE_TIMEOUT_MS = 1_500;
const monitoredProcesses = new Map();
const executeFile = util.promisify(childProcess.execFile);

/** @typedef {'unavailable'|'permission_denied'|'invalid_response'|'transport_failed'|'timeout'|'disconnected'|'isolation_rejected'} NativeControlErrorCode */

/** A safe, machine-readable failure at the native transport boundary. */
class NativeControlError extends Error {
  /**
   * Constructs a diagnostic that never includes capability or raw wire contents.
   * @param {NativeControlErrorCode} code - Stable failure category.
   * @param {string} message - Safe operator-facing explanation.
   * @returns {NativeControlError} Typed transport error.
   * @complexity O(L) time and space for diagnostic length L.
   * @example new NativeControlError('timeout', 'Native request timed out.');
   */
  constructor(code, message) {
    super(message);
    this.name = 'NativeControlError';
    this.code = code;
  }
}

/**
 * Normalizes arbitrary failures without exposing native metadata or response contents.
 * @param {unknown} error - Filesystem, parser, or socket failure.
 * @returns {NativeControlError} Safe typed error for callers.
 * @complexity O(1) time and space.
 * @example nativeFailure(null); // code transport_failed
 */
function nativeFailure(error) {
  if (error instanceof NativeControlError) return error;
  if (error instanceof SyntaxError)
    return new NativeControlError('invalid_response', 'Native JSON data is invalid.');
  const code = error && typeof error === 'object' ? error.code : undefined;
  if (code === 'ENOENT' || code === 'ECONNREFUSED')
    return new NativeControlError(
      'unavailable',
      'Native daemon is unavailable; start the daemon and retry.'
    );
  if (code === 'EACCES' || code === 'EPERM')
    return new NativeControlError(
      'permission_denied',
      'Native runtime access was denied; check workspace permissions.'
    );
  return new NativeControlError(
    'transport_failed',
    'Native transport failed; verify daemon health and retry.'
  );
}

/**
 * Validates that a process identifier can be safely tracked or signaled.
 *
 * @param {number} pid - The process identifier to validate.
 * @returns {void} No value; invalid identifiers throw a `RangeError`.
 * @complexity O(1) time and O(1) space.
 * @example
 * assertValidProcessId(4242);
 * // => undefined
 */
function assertValidProcessId(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new RangeError('A positive, safe process ID is required.');
  }
}

/**
 * Rejects legacy PID-only registration; use the protected native lifecycle.
 * @param {number} pid - Legacy process identifier, never authority.
 * @returns {never} Always throws; no process is registered or signaled.
 * @complexity O(1) time and space.
 * @example
 * registerWorkspaceProcess(4242); // throws: PID-only registration is disabled
 */
function registerWorkspaceProcess(pid) {
  assertValidProcessId(pid);
  throw new Error('PID-only registration is disabled; use spawnProtectedProcess.');
}

/**
 * Removes a child process from workspace quarantine tracking.
 *
 * @param {number} pid - The positive process identifier to stop tracking.
 * @returns {void} No value; removing an absent PID is idempotent.
 * @complexity O(1) average time and O(1) space.
 * @example
 * unregisterWorkspaceProcess(mockAgent.pid);
 * // => undefined
 */
function unregisterWorkspaceProcess(pid) {
  assertValidProcessId(pid);
  monitoredProcesses.delete(pid);
}

/**
 * Returns the number of child processes currently owned by this runtime registry.
 *
 * @returns {number} The current number of registered workspace process IDs.
 * @complexity O(1) time and O(1) space through native `Map.prototype.size`.
 * @example
 * getActiveWorkspaceProcessCount();
 * // => 2
 */
function getActiveWorkspaceProcessCount() {
  return monitoredProcesses.size;
}

/**
 * Requests isolation of one complete generation through authenticated native IPC.
 * @param {{pid:number,startTime:number,executablePath:string,parentPid:number|null}} identity - Complete process identity.
 * @param {{dispatch?: Function}} dependencies - Optional injected transport for tests.
 * @returns {Promise<Record<string,unknown>>} Confirmed receipt, or rejection without local signaling.
 * @complexity O(L) time and space for bounded identity and IPC payload length L.
 * @example
 * await quarantineProcess(identity); // => { ok: true, code: "process_isolated", ... }
 */
async function quarantineProcess(identity, dependencies = {}) {
  if (
    !identity ||
    typeof identity !== 'object' ||
    !Number.isSafeInteger(identity.pid) ||
    identity.pid <= 0 ||
    !Number.isSafeInteger(identity.startTime) ||
    identity.startTime <= 0 ||
    typeof identity.executablePath !== 'string' ||
    !path.isAbsolute(identity.executablePath) ||
    (identity.parentPid !== null &&
      (!Number.isSafeInteger(identity.parentPid) || identity.parentPid <= 0))
  ) {
    throw new TypeError('A complete process identity is required.');
  }
  const receipt = await (dependencies.dispatch ?? dispatchNativeControl)({
    process: identity,
    type: 'isolate_process',
  });
  if (!receipt || receipt.ok !== true || receipt.code !== 'process_isolated') {
    throw new NativeControlError('isolation_rejected', 'Native isolation rejected.');
  }
  return receipt;
}

/**
 * Reads one exact live process generation from the local operating system.
 *
 * @param {number} pid - The newly spawned owned child process identifier.
 * @returns {Promise<{pid:number,startTime:number,executablePath:string,parentPid:number|null}>} The compound identity accepted by native control.
 * @complexity O(L) time and space for bounded operating-system process output length L.
 * @example
 * await inspectProcessIdentity(child.pid);
 * // => { pid: 4242, startTime: 1784500000, executablePath: "/bin/sh", parentPid: 4200 }
 */
async function inspectProcessIdentity(pid) {
  assertValidProcessId(pid);
  const { stdout } = await executeFile(
    'ps',
    ['-p', String(pid), '-o', 'lstart=', '-o', 'ppid=', '-o', 'comm='],
    { maxBuffer: 4096, timeout: NATIVE_TIMEOUT_MS, env: { ...process.env, LC_ALL: 'C' } }
  );
  const match = stdout.trim().match(/^(.{24})\s+(\d+)\s+(.+)$/);
  if (match === null) {
    throw new Error('The owned child process identity could not be inspected.');
  }
  const startTime = Math.floor(Date.parse(match[1]) / 1000);
  const parentPid = Number(match[2]);
  const reportedExecutable = match[3].trim();
  const executableCandidate = reportedExecutable.includes(path.sep)
    ? reportedExecutable
    : (
        await executeFile('which', [reportedExecutable], {
          maxBuffer: 4096,
          timeout: NATIVE_TIMEOUT_MS,
        })
      ).stdout.trim();
  const executablePath = await fs.promises.realpath(executableCandidate);
  if (!Number.isSafeInteger(startTime) || startTime <= 0 || !Number.isSafeInteger(parentPid)) {
    throw new Error('The owned child process identity is invalid.');
  }
  return { executablePath, parentPid, pid, startTime };
}

/**
 * Reads bounded private daemon metadata without following a final-component symlink.
 * @param {string} file - Expected discovery or capability path.
 * @returns {Promise<string>} At most 16 KiB of UTF-8 data; insecure or oversized files reject.
 * @complexity O(L) time and space for bounded file length L.
 * @example
 * await readNativeFile('/project/.krypton/runtime/daemon.json');
 */
async function readNativeFile(file) {
  const handle = await fs.promises.open(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    ) {
      throw new NativeControlError(
        'invalid_response',
        'Native runtime metadata must be a private, owned regular file.'
      );
    }
    const buffer = Buffer.alloc(NATIVE_RESPONSE_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > NATIVE_RESPONSE_MAX_BYTES)
      throw new NativeControlError('invalid_response', 'Native runtime metadata is oversized.');
    return buffer.subarray(0, length).toString('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Dispatches one authenticated, versioned command to the workspace daemon.
 * Discovery accepts redundant dot segments only for the exact expected absolute
 * runtime files; parent traversal and redirects are rejected before any IPC.
 *
 * @param {Record<string, unknown>} command - The narrow native command payload.
 * @param {string} projectRoot - Explicit trusted project root; defaults to startup working directory.
 * @returns {Promise<Record<string, unknown>>} The validated bounded native response object.
 * @complexity O(L) time and space for bounded request and response length L.
 * @example
 * await dispatchNativeControl({ type: "health" });
 * // => { ok: true, code: "ready" }
 */
async function dispatchNativeControl(command, projectRoot = PROJECT_ROOT) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new NativeControlError('timeout', 'The native request timed out.'));
    }, NATIVE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      dispatchNativeRequest(command, projectRoot, controller.signal),
      deadline,
    ]);
  } catch (error) {
    throw nativeFailure(error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads and validates bounded workspace-specific discovery metadata.
 * @param {string} projectRoot - Trusted workspace root.
 * @returns {Promise<Record<string, unknown>>} Validated discovery record or typed rejection.
 * @complexity O(L) time and space for bounded paths and metadata L.
 * @example await discoverNativeEndpoint('/project');
 */
async function discoverNativeEndpoint(projectRoot = PROJECT_ROOT) {
  try {
    const runtimeRoot = path.resolve(projectRoot, '.krypton/runtime');
    const endpoint = JSON.parse(await readNativeFile(path.join(runtimeRoot, 'daemon.json')));
    if (
      endpoint === null ||
      typeof endpoint !== 'object' ||
      endpoint.protocolVersion !== NATIVE_PROTOCOL_VERSION ||
      typeof endpoint.endpoint !== 'string' ||
      typeof endpoint.capabilityFile !== 'string' ||
      !path.isAbsolute(endpoint.endpoint) ||
      !path.isAbsolute(endpoint.capabilityFile) ||
      endpoint.endpoint.split(path.sep).includes('..') ||
      endpoint.capabilityFile.split(path.sep).includes('..') ||
      path.resolve(endpoint.endpoint) !== path.resolve(runtimeRoot, 'daemon.sock') ||
      path.resolve(endpoint.capabilityFile) !== path.resolve(runtimeRoot, 'capability')
    ) {
      throw new NativeControlError(
        'invalid_response',
        'The native endpoint discovery record is invalid.'
      );
    }
    return endpoint;
  } catch (error) {
    throw nativeFailure(error);
  }
}

/**
 * Performs one cancellable native exchange under the caller's absolute deadline.
 * @param {Record<string, unknown>} command - Native command payload.
 * @param {string} projectRoot - Trusted workspace root.
 * @param {AbortSignal} signal - Deadline cancellation signal.
 * @returns {Promise<Record<string, unknown>>} Validated response or rejection.
 * @complexity O(L) time and space for bounded metadata and wire length L.
 * @example await dispatchNativeRequest({ type: 'health' }, '/project', signal);
 */
async function dispatchNativeRequest(command, projectRoot, signal) {
  const runtimeRoot = path.resolve(projectRoot, '.krypton/runtime');
  await discoverNativeEndpoint(projectRoot);
  signal.throwIfAborted();
  // Use trusted normalized destinations, not the raw discovery strings, for I/O.
  const socketPath = path.resolve(runtimeRoot, 'daemon.sock');
  const capabilityPath = path.resolve(runtimeRoot, 'capability');
  if (!(await fs.promises.lstat(socketPath)).isSocket()) {
    throw new NativeControlError(
      'invalid_response',
      'The native endpoint must be a workspace Unix socket, not a symlink.'
    );
  }
  signal.throwIfAborted();
  const capability = (await readNativeFile(capabilityPath)).trim();
  if (capability.length === 0)
    throw new NativeControlError('invalid_response', 'The native capability is empty.');
  signal.throwIfAborted();
  const requestId = `req-${randomUUID()}`;
  const request = JSON.stringify({
    capability,
    command,
    protocolVersion: NATIVE_PROTOCOL_VERSION,
    requestId,
  });
  if (Buffer.byteLength(request, 'utf8') > NATIVE_RESPONSE_MAX_BYTES)
    throw new NativeControlError('invalid_response', 'Native request is oversized.');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let responseText = '';
    let responseBytes = 0;
    let settled = false;

    /**
     * Settles the pending native request exactly once and releases its socket.
     *
     * @param {Error | undefined} error - The transport failure, or `undefined` to validate the response.
     * @returns {void} No value; the surrounding promise is resolved or rejected.
     * @complexity O(L) time and space to parse a bounded response of length L.
     * @example
     * complete(new Error("The native request timed out."));
     * // => rejects the pending request and destroys its socket
     */
    const complete = (error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      socket.removeAllListeners('data');
      socket.removeAllListeners('connect');
      socket.removeAllListeners('timeout');
      socket.removeAllListeners('end');
      socket.removeAllListeners('close');
      socket.destroy();
      if (error !== undefined) {
        reject(nativeFailure(error));
        return;
      }
      try {
        const response = JSON.parse(responseText.trim());
        if (
          response === null ||
          typeof response !== 'object' ||
          typeof response.ok !== 'boolean' ||
          typeof response.code !== 'string' ||
          response.requestId !== requestId ||
          response.protocolVersion !== NATIVE_PROTOCOL_VERSION
        ) {
          throw new NativeControlError(
            'invalid_response',
            'The native response does not match the request.'
          );
        }
        resolve(response);
      } catch (parseError) {
        reject(
          parseError instanceof SyntaxError
            ? new NativeControlError(
                'invalid_response',
                responseText.length === 0
                  ? 'Native daemon returned an empty response.'
                  : 'Native daemon returned malformed response JSON.'
              )
            : nativeFailure(parseError)
        );
      }
    };
    /**
     * Stops this socket when the whole-request deadline expires.
     * @returns {void} Rejects once and destroys the owned connection.
     * @complexity O(1) time and space.
     * @example abort(); // typed timeout rejection
     */
    const abort = () =>
      complete(new NativeControlError('timeout', 'The native request timed out.'));
    signal.addEventListener('abort', abort, { once: true });
    socket.setEncoding('utf8');
    socket.setTimeout(NATIVE_TIMEOUT_MS);
    socket.once('connect', () => {
      try {
        socket.end(`${request}\n`, 'utf8');
      } catch (error) {
        complete(nativeFailure(error));
      }
    });
    socket.on('data', (chunk) => {
      const chunkBytes = Buffer.byteLength(chunk, 'utf8');
      if (chunkBytes > NATIVE_RESPONSE_MAX_BYTES - responseBytes) {
        complete(new NativeControlError('invalid_response', 'The native response is oversized.'));
        return;
      }
      responseBytes += chunkBytes;
      responseText += chunk;
    });
    socket.once('end', () => complete());
    socket.once('close', () =>
      complete(
        new NativeControlError(
          'disconnected',
          'Native daemon disconnected before completing its response.'
        )
      )
    );
    socket.once('timeout', () =>
      complete(new NativeControlError('timeout', 'The native request timed out.'))
    );
    socket.on('error', complete);
  });
}

/**
 * Starts an owned child with listeners attached before any asynchronous registration.
 *
 * @param {string} command - Executable passed directly to spawn without a shell.
 * @param {readonly string[]} args - Executable arguments.
 * @param {import("node:child_process").SpawnOptions & {maxRuntimeMs?: number}} options - Spawn options and optional deadline.
 * @param {{spawn?: Function, inspect?: Function, dispatch?: Function}} dependencies - Injected OS and IPC test boundaries.
 * @returns {{child: import("node:child_process").ChildProcess, registered: Promise<object>, completed: Promise<object>}} Registration and terminal cleanup promises.
 * @complexity O(A + L) time and space for arguments A and bounded identity/frame length L; session duration follows the child.
 * @example
 * const session = startProtectedProcess("node", ["agent.js"], { stdio: "inherit" });
 * await session.registered; await session.completed;
 */
function startProtectedProcess(command, args = [], options = {}, dependencies = {}) {
  const { maxRuntimeMs, ...spawnOptions } = options;
  const inspect = dependencies.inspect ?? inspectProcessIdentity;
  const dispatch = dependencies.dispatch ?? dispatchNativeControl;
  const child = (dependencies.spawn ?? childProcess.spawn)(command, [...args], spawnOptions);
  let exited = false;
  let spawnError;
  let registrationError;
  let terminationError;
  let isolationError;
  let exitedBeforeRegistrationFailure = false;
  let identity;
  let attemptedRegistration = false;
  let registeredSuccessfully = false;
  let timeout;
  let cleanupDeadline;
  let childMayBeRunning = false;
  let resolveExit;
  const exit = new Promise((resolve) => {
    resolveExit = resolve;
  });
  child.once('exit', (code, signal) => {
    exited = true;
    if (timeout !== undefined) clearTimeout(timeout);
    if (cleanupDeadline !== undefined) clearTimeout(cleanupDeadline);
    resolveExit({ code: code ?? null, signal: signal ?? null });
  });
  child.on('error', (error) => {
    // Spawn failures have no PID and no exit event. Later errors do not prove exit.
    if (child.pid === undefined) {
      spawnError = error;
      exited = true;
      resolveExit({ code: null, signal: null });
    }
  });
  const registered = (async () => {
    try {
      if (child.pid === undefined) {
        await exit;
        throw new Error('The protected child process did not expose a PID.');
      }
      identity = await inspect(child.pid);
      if (exited) throw new Error('The child exited before native registration.');
      attemptedRegistration = true;
      const reply = await dispatch({ process: identity, type: 'register_process' });
      if (reply.ok !== true || reply.code !== 'process_registered') {
        throw new Error('The native daemon rejected child-process registration.');
      }
      registeredSuccessfully = true;
      if (!exited) monitoredProcesses.set(child.pid, identity);
      if (!exited && Number.isSafeInteger(maxRuntimeMs) && maxRuntimeMs > 0) {
        timeout = setTimeout(() => {
          void quarantineProcess(identity, { dispatch }).catch((error) => {
            isolationError = nativeFailure(error);
            console.error(
              `[KRYPTON] Native runtime deadline isolation failed (${isolationError.code}); process remains registered.`
            );
          });
        }, maxRuntimeMs);
        timeout.unref();
      }
      return identity;
    } catch (error) {
      registrationError = error instanceof Error ? error : new Error('Native registration failed.');
      exitedBeforeRegistrationFailure = exited;
      if (!exited && child.pid !== undefined) {
        /**
         * Settles failed cleanup without claiming the child exited or removing its registration.
         * @returns {void} Releases the supervisor handle and exposes an uncertain live child.
         * @complexity O(1) time and space.
         * @example unconfirmed(); // completed.childMayBeRunning is true
         */
        const unconfirmed = () => {
          if (exited) return;
          childMayBeRunning = true;
          child.unref?.();
          resolveExit({ code: null, signal: null });
        };
        cleanupDeadline = setTimeout(unconfirmed, NATIVE_TIMEOUT_MS);
        cleanupDeadline.unref();
        try {
          if (child.kill('SIGKILL') === false) {
            clearTimeout(cleanupDeadline);
            unconfirmed();
          }
        } catch (error) {
          terminationError = nativeFailure(error);
          clearTimeout(cleanupDeadline);
          unconfirmed();
        }
      }
      throw registrationError;
    }
  })();
  // Completion consumes registration failure even when a caller only awaits exit.
  const registrationSettled = registered.catch((error) => {
    registrationError ??= nativeFailure(error);
  });
  const completed = (async () => {
    const outcome = await exit;
    await registrationSettled;
    let enforcementConfirmed = false;
    let cleanupFailed = false;
    let cleanupError;
    let receiptError;
    if (timeout !== undefined) clearTimeout(timeout);
    if (identity !== undefined && attemptedRegistration && !childMayBeRunning) {
      monitoredProcesses.delete(identity.pid);
      if (registeredSuccessfully && outcome.signal === 'SIGKILL') {
        try {
          const receipt = await dispatch({ type: 'termination_receipt', process: identity });
          enforcementConfirmed = receipt.ok === true && receipt.code === 'process_isolated';
        } catch (error) {
          receiptError = nativeFailure(error);
          enforcementConfirmed = false; // Failed receipt lookup never proves attribution.
        }
      }
      try {
        const cleanup = await dispatch({ type: 'unregister_process', process: identity });
        cleanupFailed =
          !(cleanup.ok === true && cleanup.code === 'process_unregistered') &&
          !(cleanup.ok === false && cleanup.code === 'process_not_registered');
      } catch (error) {
        cleanupError = nativeFailure(error);
        cleanupFailed = true;
      }
    }
    return {
      ...outcome,
      identity,
      spawnError,
      registrationError,
      exitedBeforeRegistrationFailure,
      enforcementConfirmed,
      cleanupFailed,
      childMayBeRunning,
      terminationError,
      isolationError,
      cleanupError,
      receiptError,
    };
  })();
  return { child, registered, completed };
}

/**
 * Preserves the existing API while using the race-safe owned-child lifecycle.
 * @param {string} command - Executable to launch.
 * @param {readonly string[]} args - Executable arguments.
 * @param {import("node:child_process").SpawnOptions & {maxRuntimeMs?: number}} options - Spawn options and optional deadline.
 * @param {{spawn?: Function, inspect?: Function, dispatch?: Function}} dependencies - Injected test boundaries.
 * @returns {Promise<import("node:child_process").ChildProcess>} Registered child, or registration rejection after owned-child cleanup is requested.
 * @complexity O(A + L) setup time and space for argument and bounded identity lengths.
 * @example
 * await spawnProtectedProcess("node", ["agent.js"], { cwd: "sandbox_workspace" });
 */
async function spawnProtectedProcess(command, args = [], options = {}, dependencies = {}) {
  const session = startProtectedProcess(command, args, options, dependencies);
  await session.registered;
  return session.child;
}

module.exports = {
  NativeControlError,
  NATIVE_TIMEOUT_MS,
  discoverNativeEndpoint,
  dispatchNativeControl,
  getActiveWorkspaceProcessCount,
  inspectProcessIdentity,
  quarantineProcess,
  registerWorkspaceProcess,
  spawnProtectedProcess,
  startProtectedProcess,
  unregisterWorkspaceProcess,
};

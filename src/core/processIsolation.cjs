const fs = require('node:fs');
const childProcess = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const util = require('node:util');
const { randomUUID } = require('node:crypto');

const PROJECT_ROOT = process.cwd();
const NATIVE_PROTOCOL_VERSION = 1;
const NATIVE_RESPONSE_MAX_BYTES = 16 * 1024;
const NATIVE_TIMEOUT_MS = 2_000;
const monitoredProcesses = new Map();
const executeFile = util.promisify(childProcess.execFile);

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
  if (receipt.ok !== true || receipt.code !== 'process_isolated') {
    throw new Error('Native isolation rejected: ' + String(receipt.code));
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
      throw new Error('Native runtime metadata must be a private, owned regular file.');
    }
    const buffer = Buffer.alloc(NATIVE_RESPONSE_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > NATIVE_RESPONSE_MAX_BYTES)
      throw new Error('Native runtime metadata is oversized.');
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
    throw new Error('The native endpoint discovery record is invalid.');
  }
  // Use trusted normalized destinations, not the raw discovery strings, for I/O.
  const socketPath = path.resolve(runtimeRoot, 'daemon.sock');
  const capabilityPath = path.resolve(runtimeRoot, 'capability');
  if (!(await fs.promises.lstat(socketPath)).isSocket()) {
    throw new Error('The native endpoint must be a workspace Unix socket, not a symlink.');
  }
  const capability = (await readNativeFile(capabilityPath)).trim();
  if (capability.length === 0) throw new Error('The native capability is empty.');
  const requestId = `req-${randomUUID()}`;
  const request = JSON.stringify({
    capability,
    command,
    protocolVersion: NATIVE_PROTOCOL_VERSION,
    requestId,
  });
  if (Buffer.byteLength(request, 'utf8') > NATIVE_RESPONSE_MAX_BYTES)
    throw new Error('Native request is oversized.');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let responseText = '';
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
      clearTimeout(deadline);
      socket.removeAllListeners();
      socket.destroy();
      if (error !== undefined) {
        reject(error);
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
          throw new Error('The native response does not match the request.');
        }
        resolve(response);
      } catch (parseError) {
        reject(parseError);
      }
    };
    const deadline = setTimeout(
      () => complete(new Error('The native request timed out.')),
      NATIVE_TIMEOUT_MS
    );
    socket.setEncoding('utf8');
    socket.setTimeout(NATIVE_TIMEOUT_MS);
    socket.once('connect', () => socket.end(`${request}\n`, 'utf8'));
    socket.on('data', (chunk) => {
      if (
        Buffer.byteLength(responseText, 'utf8') + Buffer.byteLength(chunk, 'utf8') >
        NATIVE_RESPONSE_MAX_BYTES
      ) {
        complete(new Error('The native response is oversized.'));
        return;
      }
      responseText += chunk;
    });
    socket.once('end', () => complete());
    socket.once('timeout', () => complete(new Error('The native request timed out.')));
    socket.once('error', complete);
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
          void quarantineProcess(identity, { dispatch }).catch(() => {
            console.error(
              '[KRYPTON] Native runtime deadline isolation failed; process remains registered.'
            );
          });
        }, maxRuntimeMs);
        timeout.unref();
      }
      return identity;
    } catch (error) {
      registrationError = error;
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
        } catch {
          clearTimeout(cleanupDeadline);
          unconfirmed();
        }
      }
      throw error;
    }
  })();
  // Completion consumes registration failure even when a caller only awaits exit.
  const registrationSettled = registered.catch(() => undefined);
  const completed = (async () => {
    const outcome = await exit;
    await registrationSettled;
    let enforcementConfirmed = false;
    let cleanupFailed = false;
    if (timeout !== undefined) clearTimeout(timeout);
    if (identity !== undefined && attemptedRegistration && !childMayBeRunning) {
      monitoredProcesses.delete(identity.pid);
      if (registeredSuccessfully && outcome.signal === 'SIGKILL') {
        try {
          const receipt = await dispatch({ type: 'termination_receipt', process: identity });
          enforcementConfirmed = receipt.ok === true && receipt.code === 'process_isolated';
        } catch {
          // An unavailable, expired, or malformed receipt never proves attribution.
        }
      }
      try {
        const cleanup = await dispatch({ type: 'unregister_process', process: identity });
        cleanupFailed =
          !(cleanup.ok === true && cleanup.code === 'process_unregistered') &&
          !(cleanup.ok === false && cleanup.code === 'process_not_registered');
      } catch {
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
  dispatchNativeControl,
  getActiveWorkspaceProcessCount,
  inspectProcessIdentity,
  quarantineProcess,
  registerWorkspaceProcess,
  spawnProtectedProcess,
  startProtectedProcess,
  unregisterWorkspaceProcess,
};

const fs = require("node:fs");
const childProcess = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const util = require("node:util");

const PROJECT_ROOT = process.cwd();
const ALERTS_LEDGER_PATH = path.resolve(
  /* turbopackIgnore: true */ PROJECT_ROOT,
  "alerts.json",
);
const RUNTIME_RECORD_PATH = path.resolve(PROJECT_ROOT, ".krypton/runtime/daemon.json");
const NATIVE_PROTOCOL_VERSION = 1;
const NATIVE_RESPONSE_MAX_BYTES = 16 * 1024;
const NATIVE_TIMEOUT_MS = 2_000;
const monitoredProcesses = new Map();
const executeFile = util.promisify(childProcess.execFile);
let alertStream;

/**
 * Returns the lazily initialized non-blocking security ledger stream.
 *
 * @returns {import("node:fs").WriteStream} The retained append-only alert stream.
 * @complexity O(1) time and O(1) space after the first initialization.
 * @example
 * getAlertStream().write("{\"action\":\"process_quarantined\"}\n");
 * // => true when the event is accepted into the stream buffer
 */
function getAlertStream() {
  if (alertStream !== undefined) {
    return alertStream;
  }

  alertStream = fs.createWriteStream(ALERTS_LEDGER_PATH, {
    encoding: "utf8",
    flags: "a",
  });

  alertStream.on("error", (error) => {
    throw error;
  });

  return alertStream;
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
    throw new RangeError("A positive, safe process ID is required.");
  }
}

/**
 * Resolves a path against the absolute Krypton project root.
 *
 * @param {string} targetPath - The absolute or project-relative path to normalize.
 * @returns {string} The normalized absolute filesystem path.
 * @complexity O(L) time and space in path length.
 * @example
 * resolveIsolationPath("../.ssh/id_rsa");
 * // => "/absolute/parent/.ssh/id_rsa"
 */
function resolveIsolationPath(targetPath) {
  return path.resolve(
    /* turbopackIgnore: true */ PROJECT_ROOT,
    targetPath,
  );
}

/**
 * Registers an owned child process for workspace quarantine decisions.
 *
 * @param {number} pid - The positive process identifier of an owned agent child.
 * @returns {void} No value; duplicate registrations remain idempotent.
 * @complexity O(1) average time and O(1) incremental space per unique PID.
 * @example
 * registerWorkspaceProcess(mockAgent.pid);
 * // => undefined
 */
function registerWorkspaceProcess(pid) {
  assertValidProcessId(pid);
  monitoredProcesses.set(pid, {
    executablePath: "local-reference-registry",
    parentPid: null,
    pid,
    startTime: 0,
  });
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
 * @complexity O(1) time and O(1) space through native `Set.prototype.size`.
 * @example
 * getActiveWorkspaceProcessCount();
 * // => 2
 */
function getActiveWorkspaceProcessCount() {
  return monitoredProcesses.size;
}

/**
 * Terminates one registered process and asynchronously records its threat event.
 *
 * @param {number} pid - The positive process identifier of the owned agent child.
 * @param {string} illegalPath - The security context or denied path that triggered quarantine.
 * @returns {void} No value; the process is signaled and its event is queued for logging.
 * @complexity O(1) signal dispatch and stream enqueue; O(L) time and space to resolve and serialize the path.
 * @example
 * quarantineProcess(mockAgent.pid, "../.ssh/id_rsa");
 * // => undefined; the registered child receives SIGKILL
 */
function quarantineProcess(pid, illegalPath) {
  assertValidProcessId(pid);

  if (!monitoredProcesses.delete(pid)) {
    throw new Error("The process ID is not registered to this workspace.");
  }

  const event = {
    timestamp: new Date().toISOString(),
    pid,
    illegalPath: resolveIsolationPath(illegalPath),
    action: "process_quarantined",
    signal: "SIGKILL",
  };

  try {
    process.kill(pid, "SIGKILL");
  } finally {
    getAlertStream().write(`${JSON.stringify(event)}\n`);
  }
}

/**
 * Quarantines every registered workspace process for one denied event.
 *
 * @param {string} illegalPath - The denied path or security context associated with the event.
 * @returns {void} No value; every registered process ID is consumed.
 * @complexity O(P) time for P registered processes and O(1) auxiliary space.
 * @example
 * quarantineRegisteredProcesses("/project/.ssh/id_rsa");
 * // => undefined; each registered child is signaled at most once
 */
function quarantineRegisteredProcesses(illegalPath) {
  for (const pid of monitoredProcesses.keys()) {
    try {
      quarantineProcess(pid, illegalPath);
    } catch {
      // Continue isolating the remaining owned children when one PID has exited.
    }
  }
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
  const { stdout } = await executeFile("ps", [
    "-p",
    String(pid),
    "-o",
    "lstart=",
    "-o",
    "ppid=",
    "-o",
    "comm=",
  ], { maxBuffer: 4096, timeout: NATIVE_TIMEOUT_MS });
  const match = stdout.trim().match(/^(.{24})\s+(\d+)\s+(.+)$/);
  if (match === null) {
    throw new Error("The owned child process identity could not be inspected.");
  }
  const startTime = Math.floor(Date.parse(match[1]) / 1000);
  const parentPid = Number(match[2]);
  const reportedExecutable = match[3].trim();
  const executableCandidate = reportedExecutable.includes(path.sep)
    ? reportedExecutable
    : (await executeFile("which", [reportedExecutable], {
        maxBuffer: 4096,
        timeout: NATIVE_TIMEOUT_MS,
      })).stdout.trim();
  const executablePath = await fs.promises.realpath(executableCandidate);
  if (!Number.isSafeInteger(startTime) || startTime <= 0 || !Number.isSafeInteger(parentPid)) {
    throw new Error("The owned child process identity is invalid.");
  }
  return { executablePath, parentPid, pid, startTime };
}

/**
 * Dispatches one authenticated, versioned command to the workspace daemon.
 *
 * @param {Record<string, unknown>} command - The narrow native command payload.
 * @returns {Promise<Record<string, unknown>>} The validated bounded native response object.
 * @complexity O(L) time and space for bounded request and response length L.
 * @example
 * await dispatchNativeControl({ type: "health" });
 * // => { ok: true, code: "ready" }
 */
async function dispatchNativeControl(command) {
  const endpoint = JSON.parse(await fs.promises.readFile(RUNTIME_RECORD_PATH, "utf8"));
  if (
    endpoint === null ||
    typeof endpoint !== "object" ||
    endpoint.protocolVersion !== NATIVE_PROTOCOL_VERSION ||
    typeof endpoint.endpoint !== "string" ||
    typeof endpoint.capabilityFile !== "string"
  ) {
    throw new Error("The native endpoint discovery record is invalid.");
  }
  const capability = (await fs.promises.readFile(endpoint.capabilityFile, "utf8")).trim();
  const requestId = `launcher-${process.pid}-${Date.now().toString(36)}`;
  const request = JSON.stringify({
    capability,
    command,
    protocolVersion: NATIVE_PROTOCOL_VERSION,
    requestId,
  });
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint.endpoint);
    let responseText = "";
    let settled = false;
    const complete = (error) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (error !== undefined) {
        reject(error);
        return;
      }
      try {
        const response = JSON.parse(responseText.trim());
        if (response.requestId !== requestId || response.protocolVersion !== NATIVE_PROTOCOL_VERSION) {
          throw new Error("The native response does not match the request.");
        }
        resolve(response);
      } catch (parseError) {
        reject(parseError);
      }
    };
    socket.setEncoding("utf8");
    socket.setTimeout(NATIVE_TIMEOUT_MS);
    socket.once("connect", () => socket.end(`${request}\n`, "utf8"));
    socket.on("data", (chunk) => {
      responseText += chunk;
      if (Buffer.byteLength(responseText, "utf8") > NATIVE_RESPONSE_MAX_BYTES) {
        complete(new Error("The native response is oversized."));
      }
    });
    socket.once("end", () => complete());
    socket.once("timeout", () => complete(new Error("The native request timed out.")));
    socket.once("error", complete);
  });
}

/**
 * Spawns, registers, monitors, and exactly unregisters one protected child.
 *
 * @param {string} command - The executable to launch inside the protected lifecycle.
 * @param {readonly string[]} args - The bounded executable arguments.
 * @param {import("node:child_process").SpawnOptions & {maxRuntimeMs?: number}} options - Native spawn options and optional timeout.
 * @param {{spawn?: Function, inspect?: Function, dispatch?: Function}} dependencies - Optional injected test boundaries.
 * @returns {Promise<import("node:child_process").ChildProcess>} The registered owned child process.
 * @complexity O(A + L) setup time and space for A arguments and process identity length L.
 * @example
 * await spawnProtectedProcess("node", ["agent.js"], { cwd: "sandbox_workspace" });
 * // => registered ChildProcess
 */
async function spawnProtectedProcess(command, args = [], options = {}, dependencies = {}) {
  const { maxRuntimeMs, ...spawnOptions } = options;
  const spawn = dependencies.spawn ?? childProcess.spawn;
  const inspect = dependencies.inspect ?? inspectProcessIdentity;
  const dispatch = dependencies.dispatch ?? dispatchNativeControl;
  const child = spawn(command, [...args], spawnOptions);
  const pid = child.pid;
  if (pid === undefined) {
    throw new Error("The protected child process did not expose a PID.");
  }
  let identity;
  try {
    identity = await inspect(pid);
    const registration = await dispatch({ process: identity, type: "register_process" });
    if (registration.ok !== true || registration.code !== "process_registered") {
      throw new Error("The native daemon rejected child-process registration.");
    }
    monitoredProcesses.set(pid, identity);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  let cleaned = false;
  let timeout;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    monitoredProcesses.delete(pid);
    if (timeout !== undefined) clearTimeout(timeout);
    try {
      await dispatch({ process: identity, type: "unregister_process" });
    } catch {
      // The child is already gone; a stale daemon record is rejected on any later isolate request.
    }
  };
  child.once("exit", () => void cleanup());
  child.once("error", () => void cleanup());
  if (Number.isSafeInteger(maxRuntimeMs) && maxRuntimeMs > 0) {
    timeout = setTimeout(() => {
      child.kill("SIGKILL");
      void cleanup();
    }, maxRuntimeMs);
    timeout.unref();
  }
  return child;
}

module.exports = {
  dispatchNativeControl,
  getActiveWorkspaceProcessCount,
  inspectProcessIdentity,
  quarantineProcess,
  quarantineRegisteredProcesses,
  registerWorkspaceProcess,
  spawnProtectedProcess,
  unregisterWorkspaceProcess,
};

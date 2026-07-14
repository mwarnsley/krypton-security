const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = process.cwd();
const ALERTS_LEDGER_PATH = path.resolve(
  /* turbopackIgnore: true */ PROJECT_ROOT,
  "alerts.json",
);
const monitoredProcessIds = new Set();
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
  monitoredProcessIds.add(pid);
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
  monitoredProcessIds.delete(pid);
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
  return monitoredProcessIds.size;
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

  if (!monitoredProcessIds.delete(pid)) {
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
  for (const pid of monitoredProcessIds) {
    try {
      quarantineProcess(pid, illegalPath);
    } catch {
      // Continue isolating the remaining owned children when one PID has exited.
    }
  }
}

module.exports = {
  getActiveWorkspaceProcessCount,
  quarantineProcess,
  quarantineRegisteredProcesses,
  registerWorkspaceProcess,
  unregisterWorkspaceProcess,
};

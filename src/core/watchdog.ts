import fs = require("node:fs");
import path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SANDBOX_ROOT = path.resolve(PROJECT_ROOT, "sandbox_workspace");
const ALERTS_LEDGER_PATH = path.resolve(PROJECT_ROOT, "alerts.json");

const HIGH_RISK_ENDPOINTS: ReadonlySet<string> = new Set([
  ".ssh",
  ".aws",
  ".env",
]);

interface QuarantineEvent {
  readonly timestamp: string;
  readonly pid: number;
  readonly illegalPath: string;
  readonly action: "process_quarantined";
  readonly signal: "SIGKILL";
}

const alertStream = fs.createWriteStream(ALERTS_LEDGER_PATH, {
  encoding: "utf8",
  flags: "a",
});

alertStream.on("error", (error: NodeJS.ErrnoException) => {
  // Logging failures are fatal because silently losing security events would
  // violate the watchdog's fail-closed policy.
  throw error;
});

/**
 * Resolves a requested path against the absolute Krypton project root.
 *
 * @param {string} targetPath - The raw absolute or project-relative filesystem path.
 * @returns {string} The normalized absolute filesystem path.
 * @complexity O(1) with respect to policy-set size; O(L) time and space in path length.
 * @example
 * resolveRequestedPath("./sandbox_workspace/file.txt");
 * // => "/absolute/project/root/sandbox_workspace/file.txt"
 */
function resolveRequestedPath(targetPath: string): string {
  return path.resolve(PROJECT_ROOT, targetPath);
}

/**
 * Determines whether an absolute path remains within the sandbox boundary.
 *
 * @param {string} resolvedPath - The normalized absolute path to evaluate.
 * @returns {boolean} `true` when the path is the sandbox root or one of its descendants.
 * @complexity O(1) with respect to policy-set size; O(L) time and space in path length.
 * @example
 * isInsideSandbox(path.resolve(SANDBOX_ROOT, "input.txt"));
 * // => true
 */
function isInsideSandbox(resolvedPath: string): boolean {
  const relativePath = path.relative(SANDBOX_ROOT, resolvedPath);

  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/**
 * Detects sensitive endpoint segments in a normalized filesystem path.
 *
 * @param {string} resolvedPath - The normalized absolute path whose segments will be inspected.
 * @returns {boolean} `true` when the path contains a blocked endpoint such as `.ssh` or `.env`.
 * @complexity O(1) average time per Set lookup; O(L) total time and space in path length.
 * @example
 * containsHighRiskEndpoint("/project/sandbox_workspace/.ssh/id_rsa");
 * // => true
 */
function containsHighRiskEndpoint(resolvedPath: string): boolean {
  const pathSegments = resolvedPath.split(path.sep);

  return pathSegments.some(
    (segment) => {
      const normalizedSegment = segment.toLowerCase();

      return (
        HIGH_RISK_ENDPOINTS.has(normalizedSegment) ||
        normalizedSegment.startsWith(".env.")
      );
    },
  );
}

/**
 * Verifies that a requested path is contained by the sandbox and is not sensitive.
 *
 * @param {string} targetPath - The raw absolute or project-relative path requested by an agent.
 * @returns {boolean} `true` only when the resolved path is permitted by the sandbox policy.
 * @complexity O(1) average time per policy lookup; O(L) total time and space in path length.
 * @example
 * verifyPathAccess("./sandbox_workspace/input.txt");
 * // => true
 */
export function verifyPathAccess(targetPath: string): boolean {
  try {
    const resolvedPath = resolveRequestedPath(targetPath);

    return (
      isInsideSandbox(resolvedPath) &&
      !containsHighRiskEndpoint(resolvedPath)
    );
  } catch {
    return false;
  }
}

/**
 * Terminates a quarantined process and asynchronously appends its threat event.
 *
 * @param {number} pid - The positive process identifier of the owned agent child.
 * @param {string} illegalPath - The denied absolute or project-relative path that triggered quarantine.
 * @returns {void} No value; the process is signaled and its event is queued for logging.
 * @complexity O(1) signal dispatch and stream enqueue; O(L) time and space to resolve and serialize the path.
 * @example
 * quarantineProcess(mockAgent.pid, "../.ssh/id_rsa");
 * // => undefined; the owned child receives SIGKILL and an alert is queued
 */
export function quarantineProcess(pid: number, illegalPath: string): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new RangeError("A positive, safe process ID is required.");
  }

  const event: QuarantineEvent = {
    timestamp: new Date().toISOString(),
    pid,
    illegalPath: resolveRequestedPath(illegalPath),
    action: "process_quarantined",
    signal: "SIGKILL",
  };

  try {
    process.kill(pid, "SIGKILL");
  } finally {
    // One JSON object per line keeps each append atomic and avoids blocking the
    // event loop to read and rewrite the existing ledger.
    alertStream.write(`${JSON.stringify(event)}\n`);
  }
}

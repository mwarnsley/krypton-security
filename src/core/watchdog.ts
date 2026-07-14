import fs from "node:fs";
import path from "node:path";

import {
  getActiveWorkspaceProcessCount,
  quarantineProcess,
  quarantineRegisteredProcesses,
  registerWorkspaceProcess,
  unregisterWorkspaceProcess,
} from "./processIsolation.cjs";

export {
  getActiveWorkspaceProcessCount,
  quarantineProcess,
  registerWorkspaceProcess,
  unregisterWorkspaceProcess,
} from "./processIsolation.cjs";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SANDBOX_ROOT = path.resolve(PROJECT_ROOT, "sandbox_workspace");

const HIGH_RISK_ENDPOINTS: ReadonlySet<string> = new Set([
  ".ssh",
  ".aws",
  ".env",
]);
const WATCH_EVENT_TYPES: ReadonlySet<string> = new Set(["change", "rename"]);
const activeWorkspaceWatchers = new Map<string, fs.FSWatcher>();

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
 * Processes one asynchronous workspace event through the path security policy.
 *
 * @param {string} workspacePath - The absolute sandbox directory being watched.
 * @param {string} eventType - The native filesystem event type.
 * @param {string | null} filename - The relative filename reported by `fs.watch`.
 * @returns {void} No value; denied or indeterminate events quarantine tracked children.
 * @complexity O(1) event dispatch and average policy lookup; O(L) path validation and O(P) threat quarantine.
 * @example
 * handleWorkspaceEvent(SANDBOX_ROOT, "change", "input.txt");
 * // => undefined
 */
function handleWorkspaceEvent(
  workspacePath: string,
  eventType: string,
  filename: string | null,
): void {
  if (!WATCH_EVENT_TYPES.has(eventType)) {
    return;
  }

  let targetPath = workspacePath;

  try {
    if (filename === null) {
      throw new Error("The filesystem event did not include a filename.");
    }

    targetPath = path.resolve(workspacePath, filename);

    if (!verifyPathAccess(targetPath)) {
      quarantineRegisteredProcesses(targetPath);
    }
  } catch {
    quarantineRegisteredProcesses(targetPath);
  }
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
 * Starts one persistent native watcher for the quarantined workspace directory.
 *
 * @param {string} workspacePath - The absolute or project-relative sandbox path to monitor.
 * @returns {void} No value; the retained watcher dispatches events asynchronously.
 * @complexity O(1) watcher registration and event dispatch; O(L) path validation per event and O(P) only on quarantine.
 * @example
 * startWorkspaceWatcher("./sandbox_workspace");
 * // => undefined
 */
export function startWorkspaceWatcher(workspacePath: string): void {
  const resolvedWorkspacePath = resolveRequestedPath(workspacePath);

  if (resolvedWorkspacePath !== SANDBOX_ROOT) {
    throw new RangeError("Only the Krypton sandbox workspace may be watched.");
  }

  if (activeWorkspaceWatchers.has(resolvedWorkspacePath)) {
    return;
  }

  let watcher: fs.FSWatcher;

  try {
    watcher = fs.watch(
      resolvedWorkspacePath,
      {
        encoding: "utf8",
        persistent: true,
        recursive: true,
      },
      (eventType, filename) => {
        handleWorkspaceEvent(resolvedWorkspacePath, eventType, filename);
      },
    );
  } catch (error: unknown) {
    quarantineRegisteredProcesses(resolvedWorkspacePath);
    throw error;
  }

  activeWorkspaceWatchers.set(resolvedWorkspacePath, watcher);

  watcher.on("error", () => {
    activeWorkspaceWatchers.delete(resolvedWorkspacePath);
    watcher.close();
    quarantineRegisteredProcesses(resolvedWorkspacePath);
  });
}

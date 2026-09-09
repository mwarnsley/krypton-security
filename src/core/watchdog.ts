import fs from 'node:fs';
import path from 'node:path';

export {
  getActiveWorkspaceProcessCount,
  quarantineProcess,
  spawnProtectedProcess,
} from './processIsolation.cjs';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SANDBOX_ROOT = path.resolve(PROJECT_ROOT, 'sandbox_workspace');
const HIGH_RISK_ENDPOINTS: ReadonlySet<string> = new Set(['.ssh', '.aws', '.env']);
const WATCH_EVENT_TYPES: ReadonlySet<string> = new Set(['change', 'rename']);
const activeWorkspaceWatchers = new Map<string, fs.FSWatcher>();

interface WorkspaceObservation {
  readonly status: 'OBSERVED';
  readonly attribution: 'unattributed';
  readonly targetProcessId: null;
  readonly health: 'ready' | 'degraded';
  readonly failureCode?:
    'permission_denied' | 'missing_path' | 'invalid_path' | 'filesystem_failed';
}
let observation: WorkspaceObservation | undefined;

/**
 * Classifies filesystem and watcher failures without retaining sensitive raw paths.
 * @param {unknown} error - Unknown filesystem or watcher failure.
 * @returns {'permission_denied'|'missing_path'|'invalid_path'|'filesystem_failed'} Stable failure category.
 * @complexity O(1) time and space.
 * @example classifyFilesystemFailure(null); // filesystem_failed
 */
function classifyFilesystemFailure(
  error: unknown
): NonNullable<WorkspaceObservation['failureCode']> {
  if (error instanceof TypeError || error instanceof RangeError) return 'invalid_path';
  if (error !== null && typeof error === 'object' && 'code' in error) {
    if (error.code === 'EACCES' || error.code === 'EPERM') return 'permission_denied';
    if (error.code === 'ENOENT') return 'missing_path';
  }
  return 'filesystem_failed';
}

/**
 * Returns the latest bounded reference-watcher state, never process authority.
 * @returns {WorkspaceObservation | undefined} Observational/degraded state, or undefined before any event.
 * @complexity O(1) time and space.
 * @example
 * getWorkspaceObservation(); // => { status: 'OBSERVED', attribution: 'unattributed', targetProcessId: null, health: 'ready' }
 */
export function getWorkspaceObservation(): WorkspaceObservation | undefined {
  return observation;
}

/**
 * Resolves existing targets or the canonical nearest existing parent of missing targets.
 * Explicit parent traversal is denied before normalization can erase symlink semantics.
 * @param {string} targetPath - Absolute or project-relative path, without parent components.
 * @returns {string} Canonical path; filesystem uncertainty and dangling symlinks throw.
 * @complexity O(L) lexical space; up to D filesystem resolutions costing O(D * L) worst-case time for D missing ancestors.
 * @example
 * canonicalPath('./sandbox_workspace/new.txt'); // => canonical workspace + '/new.txt'
 */
function canonicalPath(targetPath: string): string {
  if (
    typeof targetPath !== 'string' ||
    targetPath.length > 4096 ||
    targetPath.trim() === '' ||
    targetPath.includes('\0') ||
    targetPath.split(/[\\/]/).includes('..')
  )
    throw new TypeError('Invalid or traversing path.');
  let candidate = path.resolve(PROJECT_ROOT, targetPath);
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(candidate), ...tail.reverse());
    } catch (error: unknown) {
      if (classifyFilesystemFailure(error) !== 'missing_path') throw error;
      // A dangling symlink is not a missing ordinary component.
      try {
        fs.lstatSync(candidate);
        throw new Error('Unresolvable existing path.');
      } catch (statError: unknown) {
        if (classifyFilesystemFailure(statError) !== 'missing_path') throw statError;
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      tail.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

/**
 * Denies sensitive path components using average-case native Set membership.
 * @param {string} value - Lexical or canonical path.
 * @returns {boolean} True when a protected credential component is present.
 * @complexity O(L) time and space; O(1) average membership per component.
 * @example
 * sensitive('/workspace/.env.production'); // => true
 */
function sensitive(value: string): boolean {
  return value
    .split(path.sep)
    .some(
      (segment) =>
        HIGH_RISK_ENDPOINTS.has(segment.toLowerCase()) || segment.toLowerCase().startsWith('.env.')
    );
}

/**
 * Checks canonical containment without granting authority to watcher events.
 * @param {string} targetPath - Requested target; parent traversal is rejected.
 * @param {string} workspaceRoot - Explicit trusted boundary; defaults to the repository sandbox.
 * @returns {boolean} False on unsafe paths, symlink escapes, missing roots, or filesystem errors.
 * @complexity O(L) lexical space; up to O(D * L) time for D missing ancestors; Set lookup is O(1) average.
 * @example
 * verifyPathAccess('./sandbox_workspace/input.txt'); // => true for a safe canonical target
 */
export function verifyPathAccess(targetPath: string, workspaceRoot = SANDBOX_ROOT): boolean {
  try {
    const root = fs.realpathSync(workspaceRoot);
    const target = canonicalPath(targetPath);
    const relative = path.relative(root, target);
    return (
      (relative === '' ||
        (relative !== '..' &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative))) &&
      !sensitive(targetPath) &&
      !sensitive(target)
    );
  } catch (error: unknown) {
    observation = {
      status: 'OBSERVED',
      attribution: 'unattributed',
      targetProcessId: null,
      health: 'degraded',
      failureCode: classifyFilesystemFailure(error),
    };
    return false;
  }
}

/**
 * Starts an observational reference watcher; native telemetry owns durable evidence.
 * @param {string} workspacePath - The repository sandbox directory.
 * @returns {void} Starts at most one watcher; setup errors throw and record degraded observation.
 * @complexity O(L) canonical setup and O(1) average Map membership; callbacks retain O(1) state.
 * @example
 * startWorkspaceWatcher('./sandbox_workspace'); // events remain OBSERVED, never signal processes
 */
export function startWorkspaceWatcher(workspacePath: string): void {
  try {
    const resolved = canonicalPath(workspacePath);
    if (resolved !== fs.realpathSync(SANDBOX_ROOT))
      throw new RangeError('Only the Krypton sandbox workspace may be watched.');
    if (activeWorkspaceWatchers.has(resolved)) return;
    const watcher = fs.watch(
      resolved,
      { encoding: 'utf8', persistent: true, recursive: true },
      (eventType, filename) => {
        if (!WATCH_EVENT_TYPES.has(eventType)) return;
        observation = {
          status: 'OBSERVED',
          attribution: 'unattributed',
          targetProcessId: null,
          health: filename === null ? 'degraded' : 'ready',
        };
      }
    );
    activeWorkspaceWatchers.set(resolved, watcher);
    watcher.on('error', (error: unknown) => {
      activeWorkspaceWatchers.delete(resolved);
      observation = {
        status: 'OBSERVED',
        attribution: 'unattributed',
        targetProcessId: null,
        health: 'degraded',
        failureCode: classifyFilesystemFailure(error),
      };
      try {
        watcher.close();
      } catch (closeError: unknown) {
        observation = { ...observation, failureCode: classifyFilesystemFailure(closeError) };
        return;
      }
    });
  } catch (error: unknown) {
    observation = {
      status: 'OBSERVED',
      attribution: 'unattributed',
      targetProcessId: null,
      health: 'degraded',
      failureCode: classifyFilesystemFailure(error),
    };
    throw error instanceof Error ? error : new Error('Workspace watcher setup failed.');
  }
}

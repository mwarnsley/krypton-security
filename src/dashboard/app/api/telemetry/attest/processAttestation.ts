import { execFile } from 'node:child_process';
import * as path from 'node:path';

export const EPHEMERAL_ORIGIN_ATTRIBUTION = 'Ephemeral Shell Task';

const PROCESS_LOOKUP_TIMEOUT_MS = 500;
const PROCESS_LOOKUP_MAX_BUFFER_BYTES = 16 * 1024;
const SCRIPT_PATH_PATTERN = /\.(?:bash|cjs|js|jsx|mjs|php|pl|py|rb|sh|ts|tsx|zsh)$/i;
const COMMAND_TOKEN_PATTERN = /"[^"]+"|'[^']+'|\S+/g;
const SHELL_EXECUTABLES = new Set(['bash', 'dash', 'fish', 'ksh', 'sh', 'zsh']);

export type ProcessCommandLookup = (targetProcessId: number) => Promise<string | undefined>;
export type ParentProcessIdLookup = (targetProcessId: number) => Promise<number | undefined>;

export interface ProcessAttestationContext {
  /** The alert path used only when the process has already left the process table. */
  readonly attemptedPath?: string;

  /** The active repository root used to validate local fallback paths. */
  readonly projectRoot?: string;
}

export interface ProcessAttestationLookups {
  /** Reads a command signature for one live process identifier. */
  readonly commandLookup: ProcessCommandLookup;

  /** Reads the parent identifier for one live process identifier. */
  readonly parentProcessIdLookup: ParentProcessIdLookup;
}

/**
 * Removes matching shell-style quotes from one process-command token.
 *
 * @param {string} token - The raw token extracted from the process command.
 * @returns {string} The token without one matching pair of wrapping quotes.
 * @complexity O(L) time and space in token length.
 * @example
 * unwrapCommandToken('"scripts/setup.sh"');
 * // => "scripts/setup.sh"
 */
function unwrapCommandToken(token: string): string {
  const firstCharacter = token.at(0);
  const lastCharacter = token.at(-1);

  if (
    token.length >= 2 &&
    (firstCharacter === '"' || firstCharacter === "'") &&
    firstCharacter === lastCharacter
  ) {
    return token.slice(1, -1);
  }

  return token;
}

/**
 * Determines whether an absolute script path belongs to the local project.
 *
 * @param {string} candidatePath - The absolute script path from the process command.
 * @param {string} projectRoot - The absolute local project root.
 * @returns {boolean} `true` when the script is contained by the project root.
 * @complexity O(L) time and space in path length.
 * @example
 * isProjectPath('/workspace/scripts/setup.sh', '/workspace');
 * // => true
 */
function isProjectPath(candidatePath: string, projectRoot: string): boolean {
  const relativePath = path.relative(projectRoot, candidatePath);

  return (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

/**
 * Extracts a dependency package or local script path from a native process command.
 *
 * Scoped and unscoped `node_modules` packages take precedence over script paths.
 * Hidden package-manager directories such as `.pnpm` and `.bin` are skipped so
 * nested real package names can still be selected.
 *
 * @param {string} command - The command line returned by the operating system.
 * @param {string} projectRoot - The project root used to relativize local scripts.
 * @returns {string} A package name, relative script path, shell task, or ephemeral fallback.
 * @complexity O(L) time and space in command and path length.
 * @example
 * extractOriginAttribution('/usr/bin/node /workspace/node_modules/@scope/tool/index.js');
 * // => "@scope/tool"
 */
export function extractOriginAttribution(
  command: string,
  projectRoot: string = process.cwd()
): string {
  const packagePattern = /(?:^|[\\/])node_modules[\\/]((?:@[^\\/\s"'`]+[\\/])?[^\\/\s"'`]+)/g;
  let packageMatch = packagePattern.exec(command);

  while (packageMatch !== null) {
    const packageName = packageMatch[1]?.replaceAll('\\', '/');

    if (packageName !== undefined && !packageName.startsWith('.')) {
      return packageName;
    }

    packageMatch = packagePattern.exec(command);
  }

  const normalizedProjectRoot = path.resolve(projectRoot);
  const commandTokens = command.match(COMMAND_TOKEN_PATTERN) ?? [];

  for (const rawToken of commandTokens) {
    const token = unwrapCommandToken(rawToken);

    if (!SCRIPT_PATH_PATTERN.test(token)) {
      continue;
    }

    if (path.isAbsolute(token)) {
      const normalizedScriptPath = path.resolve(token);

      if (isProjectPath(normalizedScriptPath, normalizedProjectRoot)) {
        return path.relative(normalizedProjectRoot, normalizedScriptPath);
      }

      continue;
    }

    if (!token.startsWith('-')) {
      return token.replace(/^\.\//, '');
    }
  }

  const executableToken = commandTokens[0];

  if (executableToken !== undefined) {
    const executableName = path.basename(unwrapCommandToken(executableToken));

    if (SHELL_EXECUTABLES.has(executableName)) {
      return `Local Script Task: ${executableName}`;
    }
  }

  return EPHEMERAL_ORIGIN_ATTRIBUTION;
}

/**
 * Derives a completed-script label from a trusted local alert path.
 *
 * @param {string | undefined} attemptedPath - The path captured by the security alert.
 * @param {string} projectRoot - The active repository root for containment validation.
 * @returns {string} A completed local script label or the ephemeral fallback.
 * @complexity O(L) time and space in path length.
 * @example
 * deriveFallbackOriginAttribution('/workspace/scripts/setup.sh', '/workspace');
 * // => "Completed Script Process: scripts/setup.sh"
 */
export function deriveFallbackOriginAttribution(
  attemptedPath: string | undefined,
  projectRoot: string = process.cwd()
): string {
  if (attemptedPath === undefined || !SCRIPT_PATH_PATTERN.test(attemptedPath)) {
    return EPHEMERAL_ORIGIN_ATTRIBUTION;
  }

  const normalizedProjectRoot = path.resolve(projectRoot);

  if (path.isAbsolute(attemptedPath)) {
    const normalizedScriptPath = path.resolve(attemptedPath);

    return isProjectPath(normalizedScriptPath, normalizedProjectRoot)
      ? `Completed Script Process: ${path.relative(normalizedProjectRoot, normalizedScriptPath)}`
      : EPHEMERAL_ORIGIN_ATTRIBUTION;
  }

  const normalizedRelativePath = path.normalize(attemptedPath).replace(/^\.\//, '');

  return normalizedRelativePath !== '..' && !normalizedRelativePath.startsWith(`..${path.sep}`)
    ? `Completed Script Process: ${normalizedRelativePath}`
    : EPHEMERAL_ORIGIN_ATTRIBUTION;
}

/**
 * Executes one bounded local `ps` query without invoking a command shell.
 *
 * @param {readonly string[]} arguments_ - The fixed process-table arguments to execute.
 * @returns {Promise<string | undefined>} Trimmed output or `undefined` on failure.
 * @complexity O(C) time and space in the bounded command-output length.
 * @example
 * await executeProcessLookup(['-p', '4242', '-o', 'command=']);
 * // => "/bin/bash scripts/setup.sh"
 */
function executeProcessLookup(arguments_: readonly string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      execFile(
        'ps',
        [...arguments_],
        {
          encoding: 'utf8',
          maxBuffer: PROCESS_LOOKUP_MAX_BUFFER_BYTES,
          timeout: PROCESS_LOOKUP_TIMEOUT_MS,
          windowsHide: true,
        },
        (error, standardOutput) => {
          const normalizedOutput = standardOutput.trim();

          resolve(error === null && normalizedOutput !== '' ? normalizedOutput : undefined);
        }
      );
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Reads one process command from the local Unix process table without a shell.
 *
 * @param {number} targetProcessId - The positive operating-system PID to inspect.
 * @returns {Promise<string | undefined>} The command text, or `undefined` when unavailable.
 * @complexity O(C) time and space in the bounded command-output length.
 * @example
 * await lookupProcessCommand(4242);
 * // => "/usr/bin/node /workspace/scripts/agent.js"
 */
export function lookupProcessCommand(targetProcessId: number): Promise<string | undefined> {
  return executeProcessLookup(['-p', String(targetProcessId), '-o', 'command=']);
}

/**
 * Reads one live process's parent identifier from the local Unix process table.
 *
 * @param {number} targetProcessId - The positive operating-system PID to inspect.
 * @returns {Promise<number | undefined>} The positive parent PID or `undefined` when unavailable.
 * @complexity O(C) time and O(1) auxiliary space for bounded numeric output.
 * @example
 * await lookupParentProcessId(4242);
 * // => 4100
 */
export async function lookupParentProcessId(targetProcessId: number): Promise<number | undefined> {
  const parentProcessOutput = await executeProcessLookup([
    '-o',
    'ppid=',
    '-p',
    String(targetProcessId),
  ]);
  const parentProcessId = Number(parentProcessOutput);

  return Number.isSafeInteger(parentProcessId) && parentProcessId > 0 ? parentProcessId : undefined;
}

/**
 * Attests one PID to a dependency package or local script execution path.
 *
 * @param {number} targetProcessId - The raw positive process identifier to attest.
 * @param {ProcessAttestationContext} context - Local alert evidence for completed processes.
 * @param {ProcessAttestationLookups} lookups - Injectable native process-table readers.
 * @returns {Promise<string>} The strongest defensible origin or ephemeral fallback.
 * @complexity O(C + L) time and space in bounded command and alert-path length.
 * @example
 * await attestProcessOrigin(4242);
 * // => "scripts/agent.ts"
 */
export async function attestProcessOrigin(
  targetProcessId: number,
  context: ProcessAttestationContext = {},
  lookups: ProcessAttestationLookups = {
    commandLookup: lookupProcessCommand,
    parentProcessIdLookup: lookupParentProcessId,
  }
): Promise<string> {
  const fallbackAttribution = deriveFallbackOriginAttribution(
    context.attemptedPath,
    context.projectRoot
  );

  if (!Number.isSafeInteger(targetProcessId) || targetProcessId <= 0) {
    return fallbackAttribution;
  }

  let command: string | undefined;

  try {
    command = await lookups.commandLookup(targetProcessId);
  } catch {
    command = undefined;
  }

  if (command !== undefined) {
    return extractOriginAttribution(command, context.projectRoot);
  }

  let parentProcessId: number | undefined;

  try {
    parentProcessId = await lookups.parentProcessIdLookup(targetProcessId);
  } catch {
    parentProcessId = undefined;
  }

  if (parentProcessId !== undefined) {
    try {
      const parentCommand = await lookups.commandLookup(parentProcessId);

      if (parentCommand !== undefined) {
        return extractOriginAttribution(parentCommand, context.projectRoot);
      }
    } catch {
      return fallbackAttribution;
    }
  }

  return fallbackAttribution;
}

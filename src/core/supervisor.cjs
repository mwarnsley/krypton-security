const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { dispatchNativeControl, startProtectedProcess } = require('./processIsolation.cjs');

const DAEMON_ERROR =
  "Krypton native daemon is not running. Please start it with 'npm run dev:full' or 'krypton daemon:start'.";
const USAGE = 'Usage: krypton run -- <command> [args...] | krypton daemon:start';

/**
 * Parses the exact CLI boundary without expanding shell syntax or target options.
 * @param {readonly string[]} argv - Arguments following the Krypton executable.
 * @returns {{type:'run',command:string,args:string[]} | {type:'daemon:start'}} Parsed invocation; invalid arguments throw.
 * @complexity O(A) time and space in total argument bytes A, bounded to 128 KiB and 4096 arguments.
 * @example
 * parseInvocation(['run', '--', 'node', 'a b']); // literal argument 'a b'
 */
function parseInvocation(argv) {
  if (
    argv.length > 4096 ||
    argv.reduce((size, arg) => size + Buffer.byteLength(arg), 0) > 131072 ||
    argv.some((arg) => arg.includes('\0'))
  )
    throw new Error(USAGE);
  if (argv.length === 1 && argv[0] === 'daemon:start') return { type: 'daemon:start' };
  if (argv[0] !== 'run' || argv[1] !== '--' || !argv[2]) throw new Error(USAGE);
  return { type: 'run', command: argv[2], args: argv.slice(3) };
}

/**
 * Reads a bounded configuration file without allocating for an unbounded input.
 * @param {string} file - Configuration path beneath the discovered checkout.
 * @returns {Promise<string>} UTF-8 content, or rejection for non-files and oversized data.
 * @complexity O(L) time and space for at most 16 KiB of configuration data L.
 * @example
 * await readConfiguration('/project/krypton.config.json');
 */
async function readConfiguration(file) {
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Invalid workspace configuration.');
    const buffer = Buffer.alloc(16385);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > 16384) throw new Error('Workspace configuration exceeds 16 KiB.');
    return buffer.subarray(0, length).toString('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Checks component containment after canonicalization.
 * @param {string} root - Canonical parent directory.
 * @param {string} candidate - Canonical child directory.
 * @returns {boolean} Whether candidate equals root or lies below it.
 * @complexity O(L) time and space in combined path length L.
 * @example
 * within('/project/sandbox', '/project/sandbox/subdir'); // true
 */
function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

/**
 * Resolves a safe relative configuration root under its canonical parent.
 * @param {string} root - Canonical parent directory.
 * @param {unknown} value - Configured nonempty relative path.
 * @returns {Promise<string>} Canonical contained directory or rejection.
 * @complexity O(L) time and space for path length L plus filesystem resolution.
 * @example
 * await configuredRoot('/project', 'sandbox_workspace');
 */
async function configuredRoot(root, value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    value.split(/[\\/]/).includes('..')
  )
    throw new Error('Invalid workspace configuration.');
  const resolved = await fs.realpath(path.resolve(root, value));
  if (!within(root, resolved) || !(await fs.stat(resolved)).isDirectory())
    throw new Error('Configured workspace escapes its root.');
  return resolved;
}

/**
 * Finds the nearest Krypton checkout and selects its existing protected workspace.
 * @param {string} cwd - Invocation directory; defaults to explicit KRYPTON_PROJECT_ROOT or current directory.
 * @returns {Promise<{repositoryRoot:string,projectRoot:string,cwd:string}>} Canonical roots; unsupported configuration fails closed.
 * @complexity O(D * L) path processing for depth D and path length L; bounded 16 KiB config storage.
 * @example
 * await resolveWorkspace('/project'); // child cwd /project/sandbox_workspace
 */
async function resolveWorkspace(cwd = process.env.KRYPTON_PROJECT_ROOT ?? process.cwd()) {
  if (!path.isAbsolute(cwd)) throw new Error('KRYPTON_PROJECT_ROOT must be absolute.');
  const invocation = await fs.realpath(cwd);
  let repositoryRoot = invocation;
  while (true) {
    try {
      await fs.access(path.join(repositoryRoot, 'krypton.config.json'));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error('Cannot inspect Krypton workspace configuration.');
      const parent = path.dirname(repositoryRoot);
      if (parent === repositoryRoot)
        throw new Error(
          'Krypton workspace not found. Run from the configured checkout or its protected workspace.'
        );
      repositoryRoot = parent;
    }
  }
  const config = JSON.parse(
    await readConfiguration(path.join(repositoryRoot, 'krypton.config.json'))
  );
  if (
    config === null ||
    typeof config !== 'object' ||
    config.runtimeDirectory !== '.krypton/runtime'
  )
    throw new Error('CLI requires runtimeDirectory .krypton/runtime.');
  const projectRoot = await configuredRoot(repositoryRoot, config.projectRoot);
  const protectedRoot = await configuredRoot(projectRoot, config.protectedWorkspaceRoot);
  if (protectedRoot === projectRoot)
    throw new Error('Protected workspace must be narrower than the project root.');
  const childCwd =
    invocation === repositoryRoot || invocation === projectRoot ? protectedRoot : invocation;
  if (!within(protectedRoot, childCwd))
    throw new Error('Run from the project root or inside its configured protected workspace.');
  return { repositoryRoot, projectRoot, cwd: childCwd };
}

/**
 * Forwards only requested termination signals to an owned live child.
 * @param {import('node:child_process').ChildProcess} child - Child object returned by spawn, never a user-supplied PID.
 * @param {import('node:events').EventEmitter} signals - Supervisor signal source.
 * @returns {() => void} Idempotent listener removal callback.
 * @complexity O(1) time and space.
 * @example
 * const remove = forwardSignals(child, process); remove();
 */
function forwardSignals(child, signals) {
  let exited = false;
  /**
   * Prevents forwarding after the owned child exits.
   * @returns {void} Marks the terminal state.
   * @complexity O(1) time and space.
   * @example markExited(); // later signals are ignored
   */
  const markExited = () => {
    exited = true;
  };
  child.once('exit', markExited);
  /**
   * Forwards SIGINT to the live owned child only.
   * @returns {void} Requests signal delivery without a PID lookup.
   * @complexity O(1) time and space.
   * @example interrupt(); // child.kill('SIGINT') while live
   */
  const interrupt = () => {
    if (!exited && child.pid !== undefined) child.kill('SIGINT');
  };
  /**
   * Forwards SIGTERM to the live owned child only.
   * @returns {void} Requests signal delivery without a PID lookup.
   * @complexity O(1) time and space.
   * @example terminate(); // child.kill('SIGTERM') while live
   */
  const terminate = () => {
    if (!exited && child.pid !== undefined) child.kill('SIGTERM');
  };
  signals.on('SIGINT', interrupt);
  signals.on('SIGTERM', terminate);
  return () => {
    signals.removeListener('SIGINT', interrupt);
    signals.removeListener('SIGTERM', terminate);
    child.removeListener('exit', markExited);
  };
}

/**
 * Converts a child's terminal state to a conventional shell exit status.
 * @param {number|null} code - Numeric child exit code.
 * @param {NodeJS.Signals|null} signal - Terminal signal when no numeric exit exists.
 * @returns {number} Child code or 128 plus signal number; unknown failure is 1.
 * @complexity O(1) time and space.
 * @example
 * exitStatus(null, 'SIGKILL'); // 137
 */
function exitStatus(code, signal) {
  return code ?? (signal && os.constants.signals[signal] ? 128 + os.constants.signals[signal] : 1);
}

/**
 * Runs the source-checkout daemon in the foreground with inherited terminal streams.
 * @param {{repositoryRoot:string}} workspace - Discovered checkout.
 * @param {{spawn:Function,signals:import('node:events').EventEmitter}} dependencies - Process boundaries.
 * @returns {Promise<number>} Cargo/daemon exit status, including missing-executable failure.
 * @complexity O(L) setup for manifest path length L; lifetime follows the daemon.
 * @example
 * await startDaemon(workspace, { spawn, signals: process });
 */
async function startDaemon(workspace, dependencies) {
  const manifest = path.join(workspace.repositoryRoot, 'src/core-native/Cargo.toml');
  await fs.access(manifest);
  const child = dependencies.spawn('cargo', ['run', '--manifest-path', manifest], {
    cwd: workspace.repositoryRoot,
    stdio: 'inherit',
    shell: false,
  });
  const remove = forwardSignals(child, dependencies.signals);
  try {
    return await new Promise((resolve) => {
      child.once('error', () => resolve(1));
      child.once('exit', (code, signal) => resolve(exitStatus(code, signal)));
    });
  } finally {
    remove();
  }
}

/**
 * Executes an approved invocation and keeps every supervisor diagnostic on stderr.
 * @param {readonly string[]} argv - Raw CLI arguments after the executable.
 * @param {object} dependencies - Optional injected workspace, process, IPC, and diagnostic boundaries for tests.
 * @returns {Promise<number>} Exit status after bounded native cleanup; no raw transport errors or capabilities are printed.
 * @complexity O(A + D * L) setup for argument bytes A, directory depth D, and path/frame length L; child lifetime is user-controlled.
 * @example
 * process.exitCode = await main(['run', '--', 'node', 'agent.js']);
 */
async function main(argv, dependencies = {}) {
  const stderr = dependencies.stderr ?? ((text) => process.stderr.write(text));
  const signals = dependencies.signals ?? process;
  let invocation;
  try {
    invocation = parseInvocation(argv);
  } catch {
    stderr(`${USAGE}\n`);
    return 2;
  }
  const platform = dependencies.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'linux') {
    stderr('[KRYPTON] Native supervision requires macOS (supported) or Linux (experimental).\n');
    return 1;
  }
  let workspace;
  try {
    workspace = await (dependencies.resolveWorkspace ?? resolveWorkspace)();
  } catch {
    stderr(
      '[KRYPTON] Workspace unavailable. Run from a configured Krypton checkout with an existing protected workspace and runtimeDirectory .krypton/runtime.\n'
    );
    return 1;
  }
  if (invocation.type === 'daemon:start') {
    try {
      return await startDaemon(workspace, { spawn: dependencies.spawn ?? spawn, signals });
    } catch {
      stderr(
        '[KRYPTON] Cannot start daemon. Install rustup/cargo and run from the Krypton source checkout.\n'
      );
      return 1;
    }
  }
  /**
   * Binds authenticated IPC to the selected project instead of the host cwd.
   * @param {Record<string,unknown>} command - Native command payload.
   * @returns {Promise<Record<string,unknown>>} Validated native envelope.
   * @complexity O(L) time and space for bounded path and payload length L.
   * @example await dispatch({ type: 'health' });
   */
  const dispatch = (command) =>
    (dependencies.dispatch ?? dispatchNativeControl)(command, workspace.projectRoot);
  try {
    const health = await dispatch({ type: 'health' });
    if (health.ok !== true || health.health?.status !== 'healthy')
      throw new Error('Daemon unavailable or degraded');
  } catch {
    stderr(`${DAEMON_ERROR}\n`);
    return 1;
  }
  let session;
  try {
    session = (dependencies.start ?? startProtectedProcess)(
      invocation.command,
      invocation.args,
      { cwd: workspace.cwd, stdio: 'inherit', shell: false },
      { dispatch }
    );
  } catch {
    stderr('[KRYPTON] Could not spawn the requested executable.\n');
    return 1;
  }
  const remove = forwardSignals(session.child, signals);
  try {
    const result = await session.completed;
    if (result.spawnError) {
      stderr('[KRYPTON] Could not spawn the requested executable.\n');
      return 127;
    }
    if (result.childMayBeRunning) {
      stderr(
        '[KRYPTON] Native registration failed and owned-child termination could not be confirmed; the child may still be running.\n'
      );
      return 1;
    }
    if (result.registrationError) {
      if (!result.exitedBeforeRegistrationFailure) {
        stderr('[KRYPTON] Native registration failed; the owned child was stopped.\n');
        return 1;
      }
      stderr(
        '[KRYPTON] Child exited before registration completed; native supervision was not established.\n'
      );
    }
    if (result.cleanupFailed)
      stderr('[KRYPTON] Native unregister could not be confirmed; the child has exited.\n');
    if (result.signal === 'SIGKILL') {
      stderr(
        result.enforcementConfirmed
          ? `[KRYPTON] Process ${session.child.pid} terminated by native security boundary enforcement.\n`
          : `[KRYPTON] Process ${session.child.pid} exited via SIGKILL; enforcement attribution is unconfirmed.\n`
      );
    }
    return exitStatus(result.code, result.signal);
  } finally {
    remove();
  }
}

module.exports = { main, parseInvocation, resolveWorkspace };

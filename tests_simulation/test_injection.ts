import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { dispatchNativeControl, inspectProcessIdentity } from '../src/core/processIsolation.cjs';
import { verifyPathAccess } from '../src/core/watchdog';

const REPOSITORY = path.resolve(__dirname, '..');
const DEADLINE_MS = 10_000;

/** Waits for bounded local fixture evidence without modifying production runtime state. */
async function waitUntil<T>(probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await pause(25);
  }
  throw new Error('Native simulation evidence timed out.');
}

/** Reads complete lines only; malformed complete native evidence fails the simulation. */
async function readRows(file: string): Promise<Record<string, unknown>[]> {
  try {
    const text = await fs.readFile(file, 'utf8');
    return text
      .slice(0, text.lastIndexOf('\n') + 1)
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Reaps an explicitly owned disposable child; never accepts a caller-supplied PID. */
async function dispose(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

async function runInjectionSimulation(): Promise<void> {
  if (process.platform !== 'darwin' && process.platform !== 'linux')
    throw new Error('Native simulation requires a supported Unix host.');
  const build = execFileSync(
    'cargo',
    ['test', '--manifest-path', 'src/core-native/Cargo.toml', '--no-run', '--message-format=json'],
    {
      cwd: REPOSITORY,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    }
  );
  const artifacts = build
    .split('\n')
    .filter(Boolean)
    .map(
      (line) => JSON.parse(line) as { executable?: string | null; profile?: { test?: boolean } }
    );
  const binary = artifacts.find((item) => item.profile?.test && item.executable)?.executable;
  assert.ok(binary, 'compiled native test fixture required');
  // A short disposable root also stays below Unix socket path length limits on macOS.
  const root = await fs.realpath(await fs.mkdtemp('/tmp/krypton-sim-'));
  let daemon: ChildProcess | undefined;
  let child: ChildProcess | undefined;
  let daemonOutput = '';
  try {
    await fs.mkdir(path.join(root, 'sandbox_workspace'));
    await fs.mkdir(path.join(root, 'outside'));
    await fs.writeFile(path.join(root, 'simulation-owned'), 'disposable test fixture');
    daemon = spawn(binary, ['--ignored', '--exact', 'simulation::daemon_fixture', '--nocapture'], {
      cwd: root,
      env: { ...process.env, KRYPTON_SIMULATION_ROOT: root },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    daemon.stdout?.on('data', (chunk: Buffer) => {
      daemonOutput = (daemonOutput + chunk.toString()).slice(-8192);
    });
    daemon.stderr?.on('data', (chunk: Buffer) => {
      daemonOutput = (daemonOutput + chunk.toString()).slice(-8192);
    });
    daemon.on('error', (error) => {
      daemonOutput = error.message;
    });
    await waitUntil(async () => {
      if (daemon?.exitCode !== null) throw new Error('Native fixture exited: ' + daemonOutput);
      return daemonOutput.includes('KRYPTON_SIMULATION_READY') ? true : undefined;
    });
    const dispatch = (command: Record<string, unknown>) => dispatchNativeControl(command, root);
    child = spawn(
      process.execPath,
      [
        '-e',
        "process.on('message', targetPath => process.send({type:'path_attempt', targetPath})); setInterval(() => {}, 1000)",
      ],
      {
        cwd: path.join(root, 'sandbox_workspace'),
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      }
    );
    child.on('error', () => {
      /* spawn failure is rejected by the awaited spawn event below */
    });
    await once(child, 'spawn');
    assert.ok(child.pid);
    const identity = await inspectProcessIdentity(child.pid);
    const registered = await dispatch({ type: 'register_process', process: identity });
    assert.equal(registered.code, 'process_registered');
    assert.equal(registered.ok, true);
    const initialHealth = await dispatch({ type: 'health' });
    assert.equal(initialHealth.activeProcessCount, 1);
    assert.deepEqual(initialHealth.health, {
      status: 'healthy',
      mode: 'audit_only',
      ipc: 'ready',
      ledger: 'ready',
      watcher: 'ready',
      registry: 'ready',
      notification: 'ready',
      telemetryQueue: 'ready',
    });
    const intent = once(child, 'message');
    child.send('../outside/escape.txt');
    const [message] = await Promise.race([
      intent,
      pause(DEADLINE_MS, undefined, { ref: false }).then(() => {
        throw new Error('Agent intent timed out');
      }),
    ]);
    assert.deepEqual(message, { type: 'path_attempt', targetPath: '../outside/escape.txt' });
    const attempt = path.join(root, 'outside', 'escape.txt');
    assert.equal(
      verifyPathAccess('../outside/escape.txt', path.join(root, 'sandbox_workspace')),
      false
    );
    assert.equal(verifyPathAccess(attempt, path.join(root, 'sandbox_workspace')), false);
    // This is a harmless fixture write, not a credential read. Its portable event
    // is observational and never supplies the identity used for isolation.
    await fs.writeFile(attempt, 'synthetic out-of-bound activity only');
    const ledgerPath = path.join(root, '.krypton/telemetry/alerts.jsonl');
    const observed = await waitUntil(async () =>
      (await readRows(ledgerPath)).find((row) => row.path === attempt)
    );
    assert.equal(observed.attribution, 'unattributed');
    assert.equal(observed.process, undefined);
    const denied = await dispatch({ type: 'isolate_process', process: identity });
    assert.equal(denied.code, 'audit_only');
    assert.equal(child.signalCode, null);
    assert.equal((await readRows(path.join(root, 'notification-receipt.jsonl'))).length, 0);
    assert.equal((await dispatch({ type: 'set_audit_mode', enabled: false })).ok, true);
    const enforcingHealth = await dispatch({ type: 'health' });
    assert.equal((enforcingHealth.health as Record<string, unknown>).mode, 'active_enforcement');
    const exit = once(child, 'exit');
    assert.equal(
      (await dispatch({ type: 'isolate_process', process: identity })).code,
      'process_isolated'
    );
    const termination = await Promise.race([
      exit,
      pause(DEADLINE_MS, undefined, { ref: false }).then(() => {
        throw new Error('Owned child exit timed out');
      }),
    ]);
    assert.equal(termination[1], 'SIGKILL');
    const receipt = await waitUntil(
      async () => (await readRows(path.join(root, 'notification-receipt.jsonl')))[0]
    );
    assert.equal(receipt.source, 'mock_notification_delivery');
    assert.ok(String(receipt.body).includes('PID ' + identity.pid));
    assert.ok(!String(receipt.body).includes(attempt));
    const daemonExit = once(daemon, 'exit');
    daemon.stdin?.end('done\n');
    const completion = await Promise.race([
      daemonExit,
      pause(DEADLINE_MS, undefined, { ref: false }).then(() => {
        throw new Error('Daemon flush timed out');
      }),
    ]);
    assert.equal(completion[0], 0, daemonOutput);
    assert.ok((await readRows(ledgerPath)).some((row) => row.id === observed.id));
    console.log(
      '[PASS] native registration → observational boundary event → authenticated SIGKILL → durable JSONL → mocked desktop receipt'
    );
  } finally {
    await dispose(child);
    await dispose(daemon);
    // Only the mkdtemp-owned fixture root is removed; real .krypton state is untouched.
    await fs.rm(root, { recursive: true, force: true });
  }
}
void runInjectionSimulation().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

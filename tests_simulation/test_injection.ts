import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { dispatchNativeControl, inspectProcessIdentity } from '../src/core/processIsolation.cjs';
import { verifyPathAccess } from '../src/core/watchdog';
import { runCli } from '../src/cli/runtime.cjs';

const REPOSITORY = path.resolve(__dirname, '..');
const DEADLINE_MS = 10_000;
// Missing sockets fail immediately; verify the full stdio round trip within the
// production 1500 ms budget. OS scheduling is not a hard real-time guarantee.
const UNAVAILABLE_RESPONSE_LIMIT_MS = 1500;

interface OwnedChildState {
  failure: Error | undefined;
  exited: Promise<void>;
}
const ownedChildren = new WeakMap<ChildProcess, OwnedChildState>();
const liveChildren = new Set<ChildProcess>();

/** Observe errors immediately; completion never rejects before its caller awaits it. */
function observeChild(child: ChildProcess): OwnedChildState {
  const existing = ownedChildren.get(child);
  if (existing) return existing;
  let finish = () => undefined as void;
  const state: OwnedChildState = {
    failure: undefined,
    exited: new Promise<void>((resolve) => {
      finish = resolve;
    }),
  };
  liveChildren.add(child);
  const complete = () => {
    liveChildren.delete(child);
    finish();
  };
  child.once('close', complete);
  child.once('exit', complete);
  child.on('error', (error: Error) => {
    state.failure = error;
    if (child.pid === undefined) complete();
  });
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream?.on('error', (error: Error) => {
      state.failure = error;
    });
  }
  ownedChildren.set(child, state);
  return state;
}

/** Clear deadlines on either outcome; timers never outlive successful operations. */
async function bounded<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' timed out.')), DEADLINE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function requireHealthyChild(child: ChildProcess): void {
  if (observeChild(child).failure) throw new Error('Disposable child or stdio failed.');
}

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
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Reaps an explicitly owned disposable child; never accepts a caller-supplied PID. */
async function dispose(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const state = observeChild(child);
  if (child.pid !== undefined && !child.kill('SIGKILL')) {
    throw new Error('Owned child cleanup signal was not delivered.');
  }
  await bounded(state.exited, 'Owned child cleanup');
}

/** Exercises the actual bin entrypoint against only the disposable authenticated daemon. */
async function runSupervisorSimulation(root: string): Promise<void> {
  await fs.writeFile(
    path.join(root, 'krypton.config.json'),
    JSON.stringify({
      projectRoot: '.',
      protectedWorkspaceRoot: 'sandbox_workspace',
      runtimeDirectory: '.krypton/runtime',
    })
  );
  const dispatch = (command: Record<string, unknown>) => dispatchNativeControl(command, root);
  const symlinkedNode = path.join(root, 'version-manager-node');
  const target = `
    process.on('SIGTERM', () => process.exit(23));
    console.log(JSON.stringify({pid:process.pid,args:process.argv.slice(1),cwd:process.cwd()}));
    process.stdin.once('data', data => {
      if (String(data).trim() === 'kill') process.kill(process.pid, 'SIGKILL');
      else process.exit(7);
    });
    // A disposable target self-expires even if supervisor startup/teardown fails.
    setTimeout(() => process.exit(99), 8000);
  `;
  for (const scenario of ['normal', 'forward', 'enforce', 'unknown']) {
    let supervisor: ChildProcess | undefined;
    let targetPid: number | undefined;
    let output = '';
    let diagnostics = '';
    try {
      supervisor = spawn(
        process.execPath,
        [
          path.join(REPOSITORY, 'src/cli.cjs'),
          'run',
          '--',
          symlinkedNode,
          '-e',
          target,
          '--',
          'literal space',
          '$(not-a-shell)',
          '--',
        ],
        {
          cwd: root,
          env: { ...process.env, KRYPTON_PROJECT_ROOT: root },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
      const state = observeChild(supervisor);
      supervisor.stdout?.on('data', (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-8192);
      });
      supervisor.stderr?.on('data', (chunk: Buffer) => {
        diagnostics = (diagnostics + chunk.toString()).slice(-8192);
      });
      const started = await waitUntil(async () => {
        requireHealthyChild(supervisor!);
        if (supervisor?.exitCode !== null)
          throw new Error(`Supervisor startup failed (${scenario}): ${diagnostics}`);
        if (!output.includes('\n')) return undefined;
        return JSON.parse(output.trim()) as { pid: number; args: string[]; cwd: string };
      });
      targetPid = started.pid;
      assert.deepEqual(started.args, ['literal space', '$(not-a-shell)', '--']);
      assert.equal(started.cwd, path.join(root, 'sandbox_workspace'));
      await waitUntil(async () =>
        (await dispatch({ type: 'health' })).activeProcessCount === 1 ? true : undefined
      );
      const identity = await inspectProcessIdentity(started.pid);
      if (scenario === 'enforce') {
        assert.equal(
          (await dispatch({ type: 'isolate_process', process: identity })).code,
          'process_isolated'
        );
      } else if (scenario === 'forward') supervisor.kill('SIGTERM');
      else supervisor.stdin?.end(scenario === 'unknown' ? 'kill\n' : 'exit\n');
      await bounded(state.exited, 'Supervisor cleanup');
      requireHealthyChild(supervisor);
      assert.equal(
        supervisor.exitCode,
        scenario === 'normal' ? 7 : scenario === 'forward' ? 23 : 137
      );
      assert.equal((await dispatch({ type: 'health' })).activeProcessCount, 0);
      assert.equal(
        output.trim().split('\n').length,
        1,
        'stdout contains only target protocol output'
      );
      if (scenario === 'enforce')
        assert.equal(
          diagnostics.trim(),
          `[KRYPTON] Process ${started.pid} terminated by native security boundary enforcement.`
        );
      else if (scenario === 'unknown')
        assert.ok(diagnostics.includes('attribution is unconfirmed'));
      else assert.equal(diagnostics, '');
      targetPid = undefined;
    } finally {
      // Shutdown is independent of successful parsing of the target's startup output.
      if (supervisor?.stdin && !supervisor.stdin.destroyed && !supervisor.stdin.writableEnded) {
        supervisor.stdin.end('kill\n');
      }
      try {
        if (targetPid !== undefined) {
          // Ask the fixture itself to exit; teardown never signals a bare target PID.
          await waitUntil(async () => {
            try {
              await inspectProcessIdentity(targetPid!);
              return undefined;
            } catch (error: unknown) {
              // ps exit 1 means no matching process. Other inspection failures
              // cannot prove exit and must fail cleanup.
              if (error instanceof Error && 'code' in error && error.code === 1) return true;
              throw error;
            }
          });
        }
      } finally {
        await dispose(supervisor);
      }
    }
  }
  for (const target of [
    { command: process.execPath, args: ['-e', 'process.exit(3)'], code: 3 },
    { command: path.join(root, 'nonexistent-fixture-command'), args: [], code: 127 },
  ]) {
    const result = spawnSync(
      process.execPath,
      [path.join(REPOSITORY, 'src/cli.cjs'), 'run', '--', target.command, ...target.args],
      {
        cwd: root,
        env: { ...process.env, KRYPTON_PROJECT_ROOT: root },
        encoding: 'utf8',
        timeout: DEADLINE_MS,
        maxBuffer: 8192,
      }
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, target.code, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal((await dispatch({ type: 'health' })).activeProcessCount, 0);
  }
  console.log(
    '[PASS] krypton run: symlinked executable, literal arguments, MCP stdout, exit codes, SIGTERM, authenticated enforcement and unknown SIGKILL'
  );
}

/** Exercises the production stdio file server via its supervisor and real native IPC. */
async function runMcpSimulation(root: string): Promise<string[]> {
  const supervisor = spawn(
    process.execPath,
    [
      path.join(REPOSITORY, 'src/cli.cjs'),
      'run',
      '--',
      process.execPath,
      path.join(REPOSITORY, 'src/core/mcp/server.cjs'),
    ],
    {
      cwd: root,
      env: { ...process.env, KRYPTON_PROJECT_ROOT: root },
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
  const state = observeChild(supervisor);
  const receiptIds: string[] = [];
  let output = '';
  let diagnostics = '';
  let nextId = 0;
  supervisor.stdout.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-65536);
  });
  supervisor.stderr.on('data', (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-8192);
  });

  const request = async (method: string, params?: Record<string, unknown>) => {
    const id = ++nextId;
    supervisor.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n'
    );
    return waitUntil(async () => {
      requireHealthyChild(supervisor);
      if (supervisor.exitCode !== null || supervisor.signalCode !== null)
        throw new Error('MCP exited: ' + diagnostics);
      const newline = output.indexOf('\n');
      if (newline < 0) return undefined;
      const response = JSON.parse(output.slice(0, newline)) as {
        id: number;
        result?: { isError?: boolean; content?: { type: string; text: string }[] };
        error?: unknown;
      };
      output = output.slice(newline + 1);
      assert.equal(response.id, id);
      assert.equal(response.error, undefined);
      return response.result;
    });
  };
  try {
    await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'disposable-test', version: '1' },
    });
    supervisor.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
    );
    await waitUntil(async () =>
      (await dispatchNativeControl({ type: 'health' }, root)).activeProcessCount === 1
        ? true
        : undefined
    );
    const written = await request('tools/call', {
      name: 'krypton_write_file',
      arguments: { path: 'mcp-note.txt', content: 'protected content' },
    });
    assert.equal(written.isError, false);
    const read = await request('tools/call', {
      name: 'krypton_read_file',
      arguments: { path: 'mcp-note.txt' },
    });
    assert.equal(read.content?.[0]?.text, 'protected content');
    const outsidePath = path.join(root, 'outside.txt');
    const outsideContent = 'disposable outside content must never be disclosed';
    await fs.writeFile(outsidePath, outsideContent);
    for (const enabled of [true, false]) {
      await dispatchNativeControl({ type: 'set_audit_mode', enabled }, root);
      const denied = await request('tools/call', {
        name: 'krypton_write_file',
        arguments: { path: '../outside/mcp-escape.txt', content: 'must not be written' },
      });
      assert.equal(denied.isError, true);
      const evidence = JSON.parse(denied.content?.[0]?.text ?? '{}') as {
        receipt: { id: string; action: string; telemetry: string };
      };
      assert.equal(evidence.receipt.action, 'denied');
      assert.equal(evidence.receipt.telemetry, 'queued');
      const row = await waitUntil(async () =>
        (await readRows(path.join(root, '.krypton/telemetry/alerts.jsonl'))).find(
          (entry) => entry.id === evidence.receipt.id
        )
      );
      assert.deepEqual(row.details, { tool: 'krypton_write_file', action: 'denied' });
      assert.equal(row.attribution, 'unattributed');
      receiptIds.push(evidence.receipt.id);
      await assert.rejects(fs.access(path.join(root, 'outside/mcp-escape.txt')), {
        code: 'ENOENT',
      });
      const readDenied = await request('tools/call', {
        name: 'krypton_read_file',
        arguments: { path: '../outside.txt' },
      });
      assert.equal(readDenied.isError, true);
      assert.ok(!JSON.stringify(readDenied).includes(outsideContent));
      const readEvidence = JSON.parse(readDenied.content?.[0]?.text ?? '{}') as {
        receipt: { id: string; action: string; telemetry: string };
      };
      assert.equal(readEvidence.receipt.action, 'denied');
      assert.equal(readEvidence.receipt.telemetry, 'queued');
      const readRow = await waitUntil(async () =>
        (await readRows(path.join(root, '.krypton/telemetry/alerts.jsonl'))).find(
          (entry) => entry.id === readEvidence.receipt.id
        )
      );
      assert.deepEqual(readRow.details, { tool: 'krypton_read_file', action: 'denied' });
      assert.equal(readRow.path, '../outside.txt');
      // The dashboard is a separate ESM package. Load its real normalizer in an
      // isolated compiler context without changing either package's module contract.
      const normalized = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '-e',
            `
        require('ts-node').register({
          compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' },
          moduleTypes: { '**/*.ts': 'cjs' }
        });
        const { normalizePersistedEvent } = require('./src/dashboard/server/telemetry/normalizeTelemetry.ts');
        const row = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
        process.stdout.write(JSON.stringify(normalizePersistedEvent(row)));
      `,
          ],
          {
            cwd: REPOSITORY,
            input: JSON.stringify(readRow),
            encoding: 'utf8',
            timeout: DEADLINE_MS,
            maxBuffer: 8192,
          }
        )
      ) as Record<string, unknown>;
      assert.equal(normalized.enforcementStatus, 'INTERCEPTED');
      assert.equal(normalized.attemptedAction, 'krypton_read_file');
      assert.equal(normalized.targetProcessId, null);
      assert.equal(normalized.attribution, 'unattributed');
      assert.equal(normalized.timestamp, readRow.capturedAt);
      assert.equal(await fs.readFile(outsidePath, 'utf8'), outsideContent);
      receiptIds.push(readEvidence.receipt.id);
    }
    // Only this simulation's disposable socket is moved; daemon disconnect must
    // return a tool error, then the same session must recover after restoration.
    const socketPath = path.join(root, '.krypton/runtime/daemon.sock');
    const offlinePath = socketPath + '.simulation-offline';
    await fs.rename(socketPath, offlinePath);
    try {
      const startedAt = performance.now();
      const unavailable = await request('tools/call', {
        name: 'krypton_read_file',
        arguments: { path: 'mcp-note.txt' },
      });
      assert.ok(
        performance.now() - startedAt <= UNAVAILABLE_RESPONSE_LIMIT_MS,
        'Missing socket response exceeds 1500 ms'
      );
      assert.equal(unavailable.isError, true);
      assert.equal(JSON.parse(unavailable.content?.[0]?.text ?? '{}').code, 'unavailable');
    } finally {
      await fs.rename(offlinePath, socketPath);
    }
    // No request-supplied identity can authorize signaling; session remains usable after denial.
    assert.equal(
      (
        await request('tools/call', {
          name: 'krypton_read_file',
          arguments: { path: 'mcp-note.txt' },
        })
      ).isError,
      false
    );
    supervisor.stdin.end();
    await bounded(state.exited, 'MCP cleanup');
    requireHealthyChild(supervisor);
    assert.equal(supervisor.exitCode, 0, diagnostics);
    assert.equal(diagnostics, '');
    console.log(
      '[PASS] production MCP: native read/write, traversal denial in both modes, durable receipts, clean stdio and supervisor cleanup'
    );
    return receiptIds;
  } finally {
    if (!supervisor.stdin.writableEnded) supervisor.stdin.end();
    if (supervisor.exitCode === null && supervisor.signalCode === null) {
      supervisor.kill('SIGTERM');
      try {
        await bounded(state.exited, 'MCP graceful cleanup');
      } finally {
        await dispose(supervisor);
      }
    }
    await dispose(supervisor);
  }
}

export async function runInjectionSimulation(): Promise<void> {
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
  let stage = 'native fixture startup';
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    process.exitCode = 1;
    // Only children spawned and retained by this harness receive shutdown signals.
    // Their production supervisor owns forwarding to its registered target.
    for (const owned of liveChildren) {
      try {
        owned.stdin?.end();
        if (!owned.kill('SIGTERM'))
          observeChild(owned).failure = new Error('Shutdown signal failed.');
      } catch (error: unknown) {
        observeChild(owned).failure =
          error instanceof Error ? error : new Error('Shutdown failed.');
      }
    }
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    await fs.mkdir(path.join(root, 'sandbox_workspace'));
    await fs.mkdir(path.join(root, 'outside'));
    await fs.writeFile(path.join(root, 'simulation-owned'), 'disposable test fixture');
    daemon = spawn(binary, ['--ignored', '--exact', 'simulation::daemon_fixture', '--nocapture'], {
      cwd: root,
      env: { ...process.env, KRYPTON_SIMULATION_ROOT: root },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const daemonState = observeChild(daemon);
    daemon.stdout?.on('data', (chunk: Buffer) => {
      daemonOutput = (daemonOutput + chunk.toString()).slice(-8192);
    });
    daemon.stderr?.on('data', (chunk: Buffer) => {
      daemonOutput = (daemonOutput + chunk.toString()).slice(-8192);
    });

    await waitUntil(async () => {
      requireHealthyChild(daemon!);
      if (daemon?.exitCode !== null) throw new Error('Native fixture exited: ' + daemonOutput);
      return daemonOutput.includes('KRYPTON_SIMULATION_READY') ? true : undefined;
    });
    const discovery = JSON.parse(
      await fs.readFile(path.join(root, '.krypton/runtime/daemon.json'), 'utf8')
    ) as { endpoint: string; capabilityFile: string };
    assert.equal(discovery.endpoint, path.join(root, '.krypton/runtime/daemon.sock'));
    assert.equal(discovery.capabilityFile, path.join(root, '.krypton/runtime/capability'));
    const dispatch = (command: Record<string, unknown>) => dispatchNativeControl(command, root);
    const symlinkedNode = path.join(root, 'version-manager-node');
    await fs.symlink(await fs.realpath(process.execPath), symlinkedNode);
    child = spawn(
      symlinkedNode,
      [
        '-e',
        "process.on('message', targetPath => process.send({type:'path_attempt', targetPath})); setInterval(() => {}, 1000)",
      ],
      {
        cwd: path.join(root, 'sandbox_workspace'),
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      }
    );
    const childState = observeChild(child);
    await bounded(once(child, 'spawn'), 'Owned child spawn');
    assert.ok(child.pid);
    const inspectedIdentity = await inspectProcessIdentity(child.pid);
    assert.equal(inspectedIdentity.executablePath, await fs.realpath(process.execPath));
    // An authenticated client may supply the executed alias; Rust pins the live canonical target.
    const identity = { ...inspectedIdentity, executablePath: symlinkedNode };
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
    const [message] = await bounded(intent, 'Agent intent');
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
    assert.equal(
      (await dispatch({ type: 'isolate_process', process: identity })).code,
      'process_isolated'
    );
    await bounded(childState.exited, 'Owned child exit');
    requireHealthyChild(child);
    assert.equal(child.signalCode, 'SIGKILL');
    const receipt = await waitUntil(
      async () => (await readRows(path.join(root, 'notification-receipt.jsonl')))[0]
    );
    assert.equal(receipt.source, 'mock_notification_delivery');
    assert.ok(String(receipt.body).includes('PID ' + identity.pid));
    assert.ok(!String(receipt.body).includes(attempt));
    stage = 'execution supervisor';
    await runSupervisorSimulation(root);
    stage = 'production MCP containment';
    const mcpReceiptIds = await runMcpSimulation(root);
    stage = 'durable daemon shutdown';
    daemon.stdin?.end('done\n');
    await bounded(daemonState.exited, 'Daemon shutdown');
    requireHealthyChild(daemon);
    assert.equal(daemon.exitCode, 0, daemonOutput);
    const durableRows = await readRows(ledgerPath);
    const durableIds = new Set(durableRows.map((row) => row.id));
    for (const id of mcpReceiptIds) assert.ok(durableIds.has(id), 'MCP receipt survives shutdown');
    assert.ok((await readRows(ledgerPath)).some((row) => row.id === observed.id));
    assert.equal(interrupted, false, 'Simulation interrupted.');
    console.log(
      '[PASS] native registration → observational boundary event → authenticated SIGKILL → durable JSONL → mocked desktop receipt'
    );
  } catch (error: unknown) {
    const failure = error instanceof Error ? 'operation_failed' : 'unexpected_failure';
    console.error(`[FAIL] ${stage}: ${failure}`);
    throw error;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    const cleanup = await Promise.allSettled([dispose(child), dispose(daemon)]);
    const failures = cleanup.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      // Preserve evidence if a child could still be using the disposable root.
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Simulation cleanup failed.'
      );
    }
    // Only the mkdtemp-owned fixture root is removed; real .krypton state is untouched.
    await fs.rm(root, { recursive: true, force: true });
  }
}
if (require.main === module) {
  void runCli(async () => {
    await runInjectionSimulation();
    return 0;
  });
}

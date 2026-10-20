import { ChildProcess, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
const packageManifest = require('../../package.json') as { version: string };
const { NativeControlError } =
  require('../../src/core/processIsolation.cjs') as typeof import('../../src/core/processIsolation.cjs');
import type { LauncherDependencies, LauncherOptions } from '../../src/packaging/launch_mcpb.cjs';
const {
  runStandaloneMcpb,
  waitForNativeReady: nativeReadiness,
  waitForNativeAttach,
  watchAttachedDaemon,
  terminateOwnedDaemon,
  settleHostEntry,
} = require('../../src/packaging/launch_mcpb.cjs') as typeof import('../../src/packaging/launch_mcpb.cjs');

const launcherPath = path.resolve('src/packaging/launch_mcpb.cjs');
const launcherPreloadPath = path.resolve('tests/packaging/launch_mcpb.preload.cjs');
const ready = { ok: true, code: 'ready', health: { status: 'healthy' } };
const discovery = {
  protocolVersion: 1,
  pid: 424242,
  endpoint: '/private/runtime-home/.krypton/runtime/daemon.sock',
  capabilityFile: '/private/runtime-home/.krypton/runtime/capability',
};
function waitForNativeReady(
  runtimeHome: string,
  child: ChildProcess,
  dependencies: Parameters<typeof nativeReadiness>[2] = {}
) {
  return nativeReadiness(runtimeHome, child, { discover: async () => discovery, ...dependencies });
}
const runtime = {
  protectedWorkspaceRoot: '/protected',
  runtimeHome: '/private/runtime-home',
  runtimeDirectory: '/private/runtime-home/.krypton/runtime',
  telemetryPath: '/private/state/telemetry/alerts.jsonl',
  configPath: '/private/state/config/runtime.json',
  daemonPath: '/private/state/bin/1.0.0/arm64/krypton-core-native',
  workspaceId: 'a'.repeat(64),
};
const streams: (PassThrough | Writable)[] = [];
const initializeFrame =
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    },
  }) + '\n';

function realServiceFixture() {
  const f = fixture();
  const frames: string[] = [];
  const callbacks: ((error?: Error | null) => void)[] = [];
  let serviceSettled = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      frames.push(chunk.toString());
      callbacks.push(callback);
    },
  });
  streams.push(output);
  const { serve } =
    require('../../src/core/mcp/server.cjs') as typeof import('../../src/core/mcp/server.cjs');
  const serving: NonNullable<LauncherDependencies['serve']> = async (input, out, options) => {
    try {
      await serve(input, out, options);
    } finally {
      serviceSettled = true;
    }
  };
  return {
    ...f,
    output,
    frames,
    callbacks,
    serviceSettled: () => serviceSettled,
    options: { ...f.options, output },
    dependencies: { ...f.dependencies, serve: serving },
  };
}

// Static preload replaces only destructive boundaries in an owned disposable Node process.
// A host prelude loads the entry the way Claude Desktop's built-in Node does: argv names the
// launcher, require.main does not, and host code may hold the event loop open or exit first.
function invokeEntry(
  serverMode: 'throw' | 'stdout' | 'stderr' | 'real' | 'readiness-failure' | 'hang',
  cli = false,
  hostPrelude?: string
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krypton-launcher-test-'));
  const signals = path.join(root, 'signals');
  const hostScript = `${hostPrelude ?? ''}
process.argv = [process.execPath, ${JSON.stringify(launcherPath)}];
require(${JSON.stringify(launcherPath)});`;
  try {
    const result = spawnSync(
      process.execPath,
      [
        '--unhandled-rejections=strict',
        '--require',
        launcherPreloadPath,
        ...(hostPrelude !== undefined
          ? ['-e', hostScript]
          : cli
            ? [path.resolve('src/cli.cjs'), 'run']
            : [launcherPath]),
      ],
      {
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 128 * 1024,
        cwd: root,
        input:
          initializeFrame +
          '{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
        env: {
          ...process.env,
          KRYPTON_TEST_SIGNALS_PATH: signals,
          KRYPTON_TEST_SERVER_MODE: serverMode,
          KRYPTON_TEST_RUNTIME: JSON.stringify(runtime),
          KRYPTON_TEST_READY: JSON.stringify(ready),
          KRYPTON_TEST_DISCOVERY: JSON.stringify(discovery),
        },
      }
    );
    return { ...result, signals: fs.existsSync(signals) ? fs.readFileSync(signals, 'utf8') : '' };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function childFixture(exitsOnSignal = true) {
  const child = new ChildProcess();
  Object.defineProperty(child, 'pid', { value: 424242, configurable: true });
  const exit = (code = 0, signal: NodeJS.Signals | null = null) => {
    Object.defineProperty(child, 'exitCode', {
      value: signal === null ? code : null,
      configurable: true,
    });
    Object.defineProperty(child, 'signalCode', { value: signal, configurable: true });
    child.emit('exit', child.exitCode, signal);
    child.emit('close', child.exitCode, signal);
  };
  const kill = vi.spyOn(child, 'kill').mockImplementation((signal) => {
    if (exitsOnSignal) queueMicrotask(() => exit(0, signal as NodeJS.Signals));
    return true;
  });
  return { child, exit, kill };
}

function fixture(exitsOnSignal = true) {
  const owned = childFixture(exitsOnSignal);
  const input = new PassThrough();
  const output = new PassThrough();
  streams.push(input, output);
  const options: LauncherOptions = {
    platform: 'darwin',
    arch: 'arm64',
    input,
    output,
    homeDirectory: '/home/test',
    configuredWorkspace: '/chosen',
  };
  const dependencies = {
    prepareRuntime: vi.fn(async () => runtime),
    spawn: vi.fn(() => owned.child),
    dispatch: vi.fn(async () => ready),
    discover: vi.fn(async () => discovery),
    serve: vi.fn(async () => undefined),
  } satisfies LauncherDependencies;
  return { ...owned, options, dependencies, input, output };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const stream of streams.splice(0)) stream.destroy();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('standalone launcher entry boundary', { timeout: 30000 }, () => {
  it('redacts an arbitrary server failure through the shared CLI boundary', () => {
    const result = invokeEntry('throw');
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('[KRYPTON] operation_failed; command failed closed.\n');
    expect({ stdout: result.stdout, signals: result.signals }).toEqual({
      stdout: '',
      signals: 'SIGTERM\n',
    });
  });
  it.each(['stdout', 'stderr'] as const)(
    'uses only exact-child synchronous fallback when %s fails',
    (stream) => {
      const result = invokeEntry(stream);
      expect(result.status).toBe(1);
      expect({ stdout: result.stdout, stderr: result.stderr }).toEqual({ stdout: '', stderr: '' });
      expect(result.signals).toBe('SIGKILL\n');
    }
  );
  it('rejects CLI arguments before launching any runtime', () => {
    const result = spawnSync(process.execPath, [launcherPath, 'unexpected'], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 128 * 1024,
      env: { ...process.env, KRYPTON_PROJECT_ROOT: '/missing-private-workspace' },
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('invalid_usage');
  });
});

describe('host shim entry guard', () => {
  it.each(['matching', 'symlink', 'import', 'missing'] as const)(
    'handles a %s argv entry without require.main identity',
    (mode) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krypton-guard-'));
      try {
        const alias = path.join(root, 'launcher.cjs');
        fs.symlinkSync(launcherPath, alias);
        const entry =
          mode === 'matching'
            ? launcherPath
            : mode === 'symlink'
              ? alias
              : mode === 'missing'
                ? path.join(root, 'missing')
                : process.execPath;
        const script = `process.argv = [process.execPath, ${JSON.stringify(entry)}, 'unexpected']; require(${JSON.stringify(launcherPath)});`;
        const result = spawnSync(process.execPath, ['-e', script], {
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 128 * 1024,
        });
        expect(result.status).toBe(['matching', 'symlink'].includes(mode) ? 2 : 0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe(
          ['matching', 'symlink'].includes(mode)
            ? '[KRYPTON] invalid_usage; launcher accepts no arguments.\n'
            : ''
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    30000
  );
});

// Host message ports keep the event loop alive; this interval stands in for one.
const openHostHandle = 'setInterval(() => undefined, 1000);';

describe('host-loaded process settlement', { timeout: 30000 }, () => {
  it('exits with the redacted failure instead of idling behind an open host handle', () => {
    const result = invokeEntry('throw', false, openHostHandle);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('[KRYPTON] operation_failed; command failed closed.\n');
    expect(result.signals).toBe('SIGTERM\n');
  });
  it('exits cleanly after serving through stdin EOF behind an open host handle', () => {
    const result = invokeEntry('real', false, openHostHandle);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.split('\n')[0] ?? '')).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-11-25' },
    });
    expect(result.signals).toBe('SIGTERM\n');
  });
  it('kills only the exact owned daemon when the host exits during service', () => {
    // Registered before the launcher, like Claude Desktop's SIGTERM -> process.exit(0) handler.
    const prelude = `${openHostHandle}
process.on('SIGTERM', () => process.exit(0));
setTimeout(() => process.emit('SIGTERM'), 500);`;
    const result = invokeEntry('hang', false, prelude);
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
      status: 0,
      stdout: '',
      stderr: '',
    });
    expect(result.signals).toBe('SIGKILL\n');
  });
});

describe('host entry settlement', () => {
  const originalExitCode = process.exitCode;
  afterEach(() => {
    process.exitCode = originalExitCode;
  });
  it.each([
    [undefined, 0],
    [0, 0],
    [1, 1],
    [2, 2],
    ['1', 1],
  ] as const)('exits a host-loaded process whose status is %j with %i', async (status, code) => {
    process.exitCode = status;
    const exit = vi.fn();
    await settleHostEntry(Promise.resolve(), true, exit);
    expect(exit).toHaveBeenCalledExactlyOnceWith(code);
  });
  it('leaves a directly executed entry to exit naturally', async () => {
    process.exitCode = 1;
    const exit = vi.fn();
    await settleHostEntry(Promise.resolve(), false, exit);
    expect(exit).not.toHaveBeenCalled();
  });
  it('fails closed with status 1 when the launch unexpectedly rejects', async () => {
    process.exitCode = undefined;
    const exit = vi.fn();
    await expect(
      settleHostEntry(Promise.reject(new Error('private failure')), true, exit)
    ).resolves.toBeUndefined();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});

describe('exit-time owned daemon fallback', () => {
  const originalExitCode = process.exitCode;
  afterEach(() => {
    process.exitCode = originalExitCode;
  });
  // Starts a session whose service never settles and returns the listener it added to 'exit'.
  async function startHungSession(f: ReturnType<typeof fixture>) {
    const before = new Set(process.listeners('exit'));
    f.dependencies.serve.mockImplementation(() => new Promise<undefined>(() => undefined));
    const running = runStandaloneMcpb(f.options, f.dependencies);
    await vi.waitFor(() => expect(f.dependencies.spawn).toHaveBeenCalledOnce());
    const added = process.listeners('exit').filter((listener) => !before.has(listener));
    return { running, added };
  }
  async function stopSession(f: ReturnType<typeof fixture>, running: Promise<number>) {
    process.emit('SIGTERM');
    if (!f.child.signalCode) f.exit();
    return running;
  }
  it('registers exactly one exit listener once the daemon is spawned', async () => {
    const f = fixture();
    const { running, added } = await startHungSession(f);
    expect(added).toHaveLength(1);
    await stopSession(f, running);
  });
  it('synchronously SIGKILLs the live owned child on abrupt exit', async () => {
    const f = fixture();
    const { running, added } = await startHungSession(f);
    (added[0] as () => void)();
    expect(f.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
    await stopSession(f, running);
  });
  it('does not signal a child that has already exited', async () => {
    const f = fixture();
    const { running, added } = await startHungSession(f);
    f.exit();
    await running;
    (added[0] as () => void)();
    expect(f.kill).not.toHaveBeenCalled();
  });
  it.each(['throw', 'false'] as const)(
    'records a failing exit status when the final kill %s',
    async (failure) => {
      const f = fixture();
      const { running, added } = await startHungSession(f);
      f.kill.mockImplementationOnce(() => {
        if (failure === 'throw') throw new Error('private capability');
        return false;
      });
      process.exitCode = 0;
      (added[0] as () => void)();
      expect(process.exitCode).toBe(1);
      await stopSession(f, running);
    }
  );
  it('removes its exit listener after bounded cleanup settles', async () => {
    const f = fixture();
    const { running, added } = await startHungSession(f);
    await stopSession(f, running);
    expect(process.listeners('exit')).not.toContain(added[0]);
  });
});

// Electron-style input exposes events and flow control, but no async iterator or readableEnded.
class SyntheticInput extends EventEmitter {
  destroyed = false;
  paused = false;
  pause() {
    this.paused = true;
    return this;
  }
  resume() {
    this.paused = false;
    return this;
  }
  destroy() {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
}

describe('synthetic stdin adapter', () => {
  it('completes an input that reached EOF before the launcher attached', async () => {
    const f = fixture();
    const input = new PassThrough({ autoDestroy: false });
    streams.push(input);
    const ended = new Promise<void>((resolve) => input.once('end', resolve));
    input.resume();
    input.end();
    await ended;
    vi.useFakeTimers();
    const { serve } =
      require('../../src/core/mcp/server.cjs') as typeof import('../../src/core/mcp/server.cjs');
    let status: number | undefined;
    const running = runStandaloneMcpb({ ...f.options, input }, { ...f.dependencies, serve }).then(
      (code) => {
        status = code;
        return code;
      }
    );
    await vi.advanceTimersByTimeAsync(0);
    const completedAtEof = status;
    if (status === undefined) process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    await running;
    expect(completedAtEof).toBe(0);
  });

  it('serves the full handshake from event-only stdin and releases listeners', async () => {
    const f = fixture();
    const input = new SyntheticInput();
    const { serve } =
      require('../../src/core/mcp/server.cjs') as typeof import('../../src/core/mcp/server.cjs');
    let output = '';
    f.output.on('data', (chunk) => {
      output += chunk.toString();
    });
    const running = runStandaloneMcpb({ ...f.options, input }, { ...f.dependencies, serve });
    input.emit(
      'data',
      Buffer.from(
        initializeFrame +
          '{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n'
      )
    );
    input.emit('end');
    input.destroy();
    expect(await running).toBe(0);
    const responses = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(responses).toMatchObject([
      { id: 1, result: { protocolVersion: '2025-11-25' } },
      { id: 2, result: { tools: [{ name: 'krypton_read_file' }, { name: 'krypton_write_file' }] } },
    ]);
    expect(input.eventNames()).toEqual([]);
  });
  it('pauses a full adapter before readiness and resumes it when consumed', async () => {
    const f = fixture();
    const input = new SyntheticInput();
    let release!: () => void;
    f.dependencies.prepareRuntime.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return runtime;
    });
    let received = 0;
    const running = runStandaloneMcpb(
      { ...f.options, input },
      {
        ...f.dependencies,
        serve: async (adapted) => {
          for await (const chunk of adapted!) {
            received += chunk.length;
          }
        },
      }
    );
    input.emit('data', Buffer.alloc(128 * 1024));
    const pausedBeforeReady = input.paused;
    release();
    await vi.waitFor(() => expect(input.paused).toBe(false));
    input.emit('end');
    expect(await running).toBe(0);
    expect({ pausedBeforeReady, received }).toEqual({
      pausedBeforeReady: true,
      received: 128 * 1024,
    });
    expect(input.eventNames()).toEqual([]);
  });
  it.each(['error', 'close'] as const)('fails closed on premature synthetic %s', async (event) => {
    const f = fixture();
    const input = new SyntheticInput();
    const running = runStandaloneMcpb({ ...f.options, input }, f.dependencies);
    input.emit(event, new Error('private input'));
    expect(await running).toBe(1);
    expect(input.eventNames()).toEqual([]);
  });
  it('owns immediate startup rejection while stdin is idle', async () => {
    const f = fixture();
    f.dependencies.discover.mockRejectedValue(new Error('private startup'));
    expect(await runStandaloneMcpb(f.options, f.dependencies)).toBe(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.kill.mock.calls).toEqual([['SIGTERM']]);
  });
});

describe('standalone host and spawn boundary', () => {
  it.each([
    ['linux', 'arm64'],
    ['win32', 'x64'],
    ['darwin', 'ia32'],
    ['darwin', 'riscv64'],
  ] as const)('rejects %s/%s before preparation', async (platform, arch) => {
    const f = fixture();
    expect(await runStandaloneMcpb({ ...f.options, platform, arch }, f.dependencies)).toBe(1);
    expect(f.dependencies.prepareRuntime).not.toHaveBeenCalled();
    expect(f.dependencies.spawn).not.toHaveBeenCalled();
  });
  it.each(['arm64', 'x64'])('prepares a standalone %s runtime', async (arch) => {
    const f = fixture();
    expect(await runStandaloneMcpb({ ...f.options, arch }, f.dependencies)).toBe(0);
    expect(f.dependencies.prepareRuntime).toHaveBeenCalledWith({
      bundleRoot: path.resolve('.'),
      version: packageManifest.version,
      platform: 'darwin',
      arch,
      homeDirectory: '/home/test',
      configuredWorkspace: '/chosen',
    });
  });
  it('uses the protected workspace environment when not directly configured', async () => {
    vi.stubEnv('KRYPTON_PROTECTED_WORKSPACE_ROOT', '/environment-selected');
    const f = fixture();
    delete f.options.configuredWorkspace;
    await runStandaloneMcpb(f.options, f.dependencies);
    expect(f.dependencies.prepareRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        configuredWorkspace: '/environment-selected',
      })
    );
  });
  it('spawns only the prepared absolute binary without a shell or shared stdio', async () => {
    const f = fixture();
    expect(await runStandaloneMcpb(f.options, f.dependencies)).toBe(0);
    expect(f.dependencies.spawn).toHaveBeenCalledWith(
      runtime.daemonPath,
      ['--standalone-config', runtime.configPath],
      { shell: false, stdio: ['ignore', 'ignore', 'ignore'] }
    );
    expect(f.dependencies.serve).toHaveBeenCalledWith(expect.any(PassThrough), f.output, {
      runtimeHome: '/private/runtime-home',
    });
  });
  it('never spawns or serves after preparation fails', async () => {
    const f = fixture();
    f.dependencies.prepareRuntime.mockRejectedValue(new Error('private capability'));
    expect(await runStandaloneMcpb(f.options, f.dependencies)).toBe(1);
    expect(f.dependencies.spawn).not.toHaveBeenCalled();
    expect(f.dependencies.serve).not.toHaveBeenCalled();
  });
  it('fails closed on synchronous spawn rejection', async () => {
    const f = fixture();
    f.dependencies.spawn.mockImplementation(() => {
      throw new Error('private capability');
    });
    expect(await runStandaloneMcpb(f.options, f.dependencies)).toBe(1);
    expect(f.dependencies.serve).not.toHaveBeenCalled();
  });
  it('owns asynchronous spawn rejection', async () => {
    const f = fixture();
    Object.defineProperty(f.child, 'pid', { value: undefined });
    f.dependencies.dispatch.mockImplementation(() => new Promise(() => undefined));
    const running = runStandaloneMcpb(f.options, f.dependencies);
    await vi.waitFor(() => expect(f.dependencies.spawn).toHaveBeenCalled());
    f.child.emit('error', new Error('private capability'));
    f.child.emit('close', -1, null);
    expect(await running).toBe(1);
    expect(f.kill).not.toHaveBeenCalled();
  });
});

describe('authenticated bounded native readiness', () => {
  it('waits for stale discovery to transition to the owned child before health or serving', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const f = fixture();
    f.dependencies.discover.mockImplementation(async () => ({
      ...discovery,
      pid: Date.now() < 300 ? 989898 : 424242,
    }));
    const running = runStandaloneMcpb(f.options, { ...f.dependencies, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(299);
    const beforePublication = {
      health: f.dependencies.dispatch.mock.calls.length,
      served: f.dependencies.serve.mock.calls.length,
      signals: f.kill.mock.calls.length,
    };
    await vi.advanceTimersByTimeAsync(1);
    expect(beforePublication).toEqual({ health: 0, served: 0, signals: 0 });
    expect(await running).toBe(0);
    expect({
      health: f.dependencies.dispatch.mock.calls.length,
      served: f.dependencies.serve.mock.calls.length,
      discovery: f.dependencies.discover.mock.calls.length,
      timers: vi.getTimerCount(),
    }).toEqual({ health: 1, served: 1, discovery: 5, timers: 0 });
  });
  it('bounds permanent stale discovery to twenty attempts without probing another daemon', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.dependencies.discover.mockResolvedValue({ ...discovery, pid: 989898 });
    await expect(
      waitForNativeReady(runtime.runtimeHome, f.child, {
        ...f.dependencies,
        now: () => 0,
        delay: async () => undefined,
      })
    ).rejects.toMatchObject({ code: 'native_busy', message: 'native_busy' });
    expect({
      discovery: f.dependencies.discover.mock.calls.length,
      health: f.dependencies.dispatch.mock.calls.length,
    }).toEqual({ discovery: 20, health: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves the five-second deadline after stale discovery while the next read stalls', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.dependencies.discover
      .mockResolvedValueOnce({ ...discovery, pid: 989898 })
      .mockImplementation(() => new Promise(() => undefined));
    const waiting = waitForNativeReady(runtime.runtimeHome, f.child, f.dependencies).then(
      () => ({ code: 'resolved' }),
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await waiting).toMatchObject({ code: 'readiness_timeout' });
    expect({
      discovery: f.dependencies.discover.mock.calls.length,
      health: f.dependencies.dispatch.mock.calls.length,
      timers: vi.getTimerCount(),
    }).toEqual({ discovery: 2, health: 0, timers: 0 });
  });
  it('attaches after its owned child loses the lock election, without signaling discovery', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const other = childFixture();
    Object.defineProperty(other.child, 'pid', { value: 989898 });
    f.dependencies.discover.mockResolvedValue({ ...discovery, pid: 989898 });
    const running = runStandaloneMcpb(f.options, f.dependencies);
    await vi.advanceTimersByTimeAsync(100);
    const waitingCalls = f.dependencies.discover.mock.calls.length;
    f.exit(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(await running).toBe(0);
    expect(waitingCalls).toBe(2);
    expect({
      health: f.dependencies.dispatch.mock.calls.length,
      served: f.dependencies.serve.mock.calls.length,
      ownedSignals: f.kill.mock.calls,
      otherSignals: other.kill.mock.calls,
      timers: vi.getTimerCount(),
    }).toEqual({ health: 1, served: 1, ownedSignals: [], otherSignals: [], timers: 0 });
  });
  it.each(['permission_denied', 'invalid_response', 'transport_failed', 'timeout'] as const)(
    'does not retry discovery %s after stale metadata',
    async (code) => {
      const f = fixture();
      f.dependencies.discover
        .mockResolvedValueOnce({ ...discovery, pid: 989898 })
        .mockRejectedValue(new NativeControlError(code, 'private capability'));
      await expect(
        waitForNativeReady(runtime.runtimeHome, f.child, {
          ...f.dependencies,
          delay: async () => undefined,
        })
      ).rejects.toMatchObject({ code: 'readiness_failed' });
      expect({
        discovery: f.dependencies.discover.mock.calls.length,
        health: f.dependencies.dispatch.mock.calls.length,
      }).toEqual({ discovery: 2, health: 0 });
    }
  );
  it.each(['unavailable', 'disconnected'] as const)(
    'allows transient discovery %s while waiting for publication',
    async (code) => {
      const f = fixture();
      f.dependencies.discover
        .mockResolvedValueOnce({ ...discovery, pid: 989898 })
        .mockRejectedValueOnce(new NativeControlError(code, 'private capability'))
        .mockResolvedValue(discovery);
      await waitForNativeReady(runtime.runtimeHome, f.child, {
        ...f.dependencies,
        delay: async () => undefined,
      });
      expect({
        discovery: f.dependencies.discover.mock.calls.length,
        health: f.dependencies.dispatch.mock.calls.length,
      }).toEqual({ discovery: 4, health: 1 });
    }
  );
  it('rejects a healthy concurrent instance as busy without signaling its PID', async () => {
    const owned = fixture();
    const other = childFixture();
    Object.defineProperty(other.child, 'pid', { value: 989898 });
    owned.dependencies.discover.mockResolvedValue({ ...discovery, pid: 989898 });
    await expect(
      waitForNativeReady(runtime.runtimeHome, owned.child, {
        ...owned.dependencies,
        delay: async () => undefined,
      })
    ).rejects.toMatchObject({ code: 'native_busy', message: 'native_busy' });
    expect(owned.dependencies.dispatch).not.toHaveBeenCalled();
    expect(other.kill).not.toHaveBeenCalled();
  });
  it('releases only its own busy child before attaching to the healthy instance', async () => {
    const owned = fixture();
    const other = childFixture();
    Object.defineProperty(other.child, 'pid', { value: 989898 });
    owned.dependencies.discover.mockResolvedValue({ ...discovery, pid: 989898 });
    expect(
      await runStandaloneMcpb(owned.options, {
        ...owned.dependencies,
        delay: async () => undefined,
      })
    ).toBe(0);
    expect({
      served: owned.dependencies.serve.mock.calls.length,
      ownedSignals: owned.kill.mock.calls,
      otherSignals: other.kill.mock.calls,
    }).toEqual({ served: 1, ownedSignals: [['SIGTERM']], otherSignals: [] });
  });
  it.each([undefined, 0, -1, 1.5, '424242'])('rejects malformed discovery pid %j', async (pid) => {
    const { child } = childFixture();
    await expect(
      waitForNativeReady(runtime.runtimeHome, child, {
        dispatch: async () => ready,
        discover: async () => ({ ...discovery, pid }),
      })
    ).rejects.toMatchObject({ code: 'readiness_failed' });
  });
  it.each([undefined, 0, -1, 1.5])(
    'rejects a nonpositive or invalid spawned pid %j',
    async (pid) => {
      const { child } = childFixture();
      Object.defineProperty(child, 'pid', { value: pid });
      await expect(
        waitForNativeReady(runtime.runtimeHome, child, { dispatch: async () => ready })
      ).rejects.toMatchObject({ code: 'native_failed' });
    }
  );
  it('checks private discovery identity again after authenticated health', async () => {
    const { child } = childFixture();
    const discover = vi
      .fn()
      .mockResolvedValueOnce(discovery)
      .mockResolvedValue({ ...discovery, pid: 989898 });
    await expect(
      waitForNativeReady(runtime.runtimeHome, child, {
        discover,
        dispatch: async () => ready,
        delay: async () => undefined,
      })
    ).rejects.toMatchObject({ code: 'native_busy' });
    expect(discover).toHaveBeenCalledTimes(21);
  });
  it('keeps the absolute deadline around a stalled private discovery read', async () => {
    vi.useFakeTimers();
    const { child } = childFixture();
    const waiting = waitForNativeReady(runtime.runtimeHome, child, {
      discover: () => new Promise(() => undefined),
      dispatch: async () => ready,
    }).then(
      () => ({ code: 'resolved' }),
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await waiting).toMatchObject({ code: 'readiness_timeout' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not accept readiness when the owned child exits during discovery', async () => {
    const { child, exit } = childFixture();
    await expect(
      waitForNativeReady(runtime.runtimeHome, child, {
        dispatch: async () => ready,
        discover: async () => {
          exit();
          return discovery;
        },
      })
    ).rejects.toMatchObject({ code: 'native_exited' });
  });
  it('accepts healthy authenticated readiness using the explicit runtime home', async () => {
    const { child } = childFixture();
    const dispatch = vi.fn(async () => ready);
    await expect(
      waitForNativeReady('/private/runtime-home', child, { dispatch })
    ).resolves.toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith({ type: 'health' }, '/private/runtime-home');
  });
  it.each([
    {},
    { ok: true, code: 'ready' },
    { ok: true, code: 'ready', health: { status: 'degraded' } },
    { ok: false, code: 'ready', health: { status: 'healthy' } },
    { ok: true, code: 'busy', health: { status: 'healthy' } },
    { ok: false, code: 'authentication_failed' },
    { ok: false, code: 'invalid_config' },
  ])('rejects nonhealthy or malformed health %j without retry', async (response) => {
    const { child } = childFixture();
    const dispatch = vi.fn(async () => response);
    await expect(
      waitForNativeReady('/private/runtime-home', child, { dispatch })
    ).rejects.toMatchObject({ code: 'native_unhealthy' });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it.each(['unavailable', 'disconnected'] as const)(
    'retries transient %s then succeeds',
    async (code) => {
      const { child } = childFixture();
      const dispatch = vi
        .fn()
        .mockRejectedValueOnce(new NativeControlError(code, 'private capability'))
        .mockResolvedValue(ready);
      await waitForNativeReady('/private/runtime-home', child, {
        dispatch,
        delay: async () => undefined,
      });
      expect(dispatch).toHaveBeenCalledTimes(2);
    }
  );
  it.each(['permission_denied', 'invalid_response', 'transport_failed', 'timeout'] as const)(
    'does not retry %s',
    async (code) => {
      const { child } = childFixture();
      const dispatch = vi
        .fn()
        .mockRejectedValue(new NativeControlError(code, 'private capability'));
      await expect(
        waitForNativeReady('/private/runtime-home', child, { dispatch })
      ).rejects.toMatchObject({ code: 'readiness_failed', message: 'readiness_failed' });
      expect(dispatch).toHaveBeenCalledTimes(1);
    }
  );
  it('caps rapid transient probes even if injected time never advances', async () => {
    const { child } = childFixture();
    const dispatch = vi.fn().mockRejectedValue(new NativeControlError('unavailable', 'private'));
    await expect(
      waitForNativeReady('/private/runtime-home', child, {
        dispatch,
        now: () => 0,
        delay: async () => undefined,
      })
    ).rejects.toMatchObject({ code: 'readiness_timeout' });
    expect(dispatch).toHaveBeenCalledTimes(20);
  });
  it('rejects a pending probe at the absolute five-second deadline', async () => {
    vi.useFakeTimers();
    const { child } = childFixture();
    const waiting = waitForNativeReady('/private/runtime-home', child, {
      dispatch: () => new Promise(() => undefined),
    });
    const rejected = expect(waiting).rejects.toMatchObject({ code: 'readiness_timeout' });
    await vi.advanceTimersByTimeAsync(4999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never accepts a healthy reply that arrives at the absolute deadline', async () => {
    const { child } = childFixture();
    let now = 0;
    await expect(
      waitForNativeReady('/private/runtime-home', child, {
        now: () => now,
        dispatch: async () => {
          now = 5000;
          return ready;
        },
      })
    ).rejects.toMatchObject({ code: 'readiness_timeout' });
  });
  it('fails immediately if the owned child exits during a probe', async () => {
    const { child, exit } = childFixture();
    const waiting = waitForNativeReady('/private/runtime-home', child, {
      dispatch: () => new Promise(() => undefined),
    });
    exit();
    await expect(waiting).rejects.toMatchObject({ code: 'native_exited' });
  });
});

const sibling = { ...discovery, pid: 989898 };
const unavailable = () => new NativeControlError('unavailable', 'private capability');
const startingHealth = {
  ok: true,
  code: 'degraded',
  health: { status: 'degraded', watcher: 'starting' },
};

describe('attached native readiness', () => {
  const immediate = { delay: async () => undefined };
  it('accepts a healthy sibling daemon using only the explicit runtime home', async () => {
    const dispatch = vi.fn(async () => ready);
    await waitForNativeAttach(runtime.runtimeHome, { discover: async () => sibling, dispatch });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'health' }, runtime.runtimeHome);
  });
  it.each(['unavailable', 'disconnected'] as const)(
    'retries transient %s while the winning owner publishes',
    async (code) => {
      const dispatch = vi
        .fn()
        .mockRejectedValueOnce(new NativeControlError(code, 'private capability'))
        .mockResolvedValue(ready);
      await waitForNativeAttach(runtime.runtimeHome, {
        ...immediate,
        discover: async () => sibling,
        dispatch,
      });
      expect(dispatch).toHaveBeenCalledTimes(2);
    }
  );
  it('rejects native_unreachable after twenty unanswered attempts', async () => {
    const discover = vi.fn(async () => sibling);
    await expect(
      waitForNativeAttach(runtime.runtimeHome, {
        ...immediate,
        discover,
        dispatch: async () => {
          throw unavailable();
        },
      })
    ).rejects.toMatchObject({ code: 'native_unreachable', message: 'native_unreachable' });
    expect(discover).toHaveBeenCalledTimes(20);
  });
  it('rejects native_unreachable at the absolute deadline while discovery stalls', async () => {
    vi.useFakeTimers();
    const waiting = waitForNativeAttach(runtime.runtimeHome, {
      discover: () => new Promise(() => undefined),
      dispatch: async () => ready,
    }).then(
      () => ({ code: 'resolved' }),
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await waiting).toMatchObject({ code: 'native_unreachable' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for an owner whose watcher is still starting', async () => {
    const dispatch = vi.fn().mockResolvedValueOnce(startingHealth).mockResolvedValue(ready);
    await waitForNativeAttach(runtime.runtimeHome, {
      ...immediate,
      discover: async () => sibling,
      dispatch,
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
  it('times out rather than attaching to an owner that never finishes starting', async () => {
    await expect(
      waitForNativeAttach(runtime.runtimeHome, {
        ...immediate,
        discover: async () => sibling,
        dispatch: async () => startingHealth,
      })
    ).rejects.toMatchObject({ code: 'readiness_timeout' });
  });
  it.each([
    {},
    { ok: true, code: 'ready' },
    { ok: true, code: 'degraded', health: { status: 'degraded', watcher: 'ready' } },
    { ok: true, code: 'busy', health: { status: 'healthy' } },
    { ok: false, code: 'invalid_config' },
  ])('rejects unhealthy sibling health %j without retry', async (response) => {
    const dispatch = vi.fn(async () => response);
    await expect(
      waitForNativeAttach(runtime.runtimeHome, { discover: async () => sibling, dispatch })
    ).rejects.toMatchObject({ code: 'native_unhealthy' });
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it('fails closed when stable discovery rejects the private capability', async () => {
    const dispatch = vi.fn(async () => ({ ok: false, code: 'unauthorized' }));
    await expect(
      waitForNativeAttach(runtime.runtimeHome, {
        ...immediate,
        discover: async () => sibling,
        dispatch,
      })
    ).rejects.toMatchObject({ code: 'native_unauthorized', message: 'native_unauthorized' });
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it('accepts a republished owner after one capability rejection', async () => {
    const discover = vi
      .fn()
      .mockResolvedValueOnce(sibling)
      .mockResolvedValueOnce(sibling)
      .mockResolvedValue({ ...discovery, pid: 515151 });
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 'unauthorized' })
      .mockResolvedValue(ready);
    await waitForNativeAttach(runtime.runtimeHome, { ...immediate, discover, dispatch });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
  it('allows only one capability rejection across republications', async () => {
    const discover = vi
      .fn()
      .mockResolvedValueOnce(sibling)
      .mockResolvedValueOnce(sibling)
      .mockResolvedValue({ ...discovery, pid: 515151 });
    await expect(
      waitForNativeAttach(runtime.runtimeHome, {
        ...immediate,
        discover,
        dispatch: async () => ({ ok: false, code: 'unauthorized' }),
      })
    ).rejects.toMatchObject({ code: 'native_unauthorized' });
  });
  it('retries when discovery is republished during the health probe', async () => {
    const discover = vi
      .fn()
      .mockResolvedValueOnce(sibling)
      .mockResolvedValue({ ...discovery, pid: 515151 });
    const dispatch = vi.fn(async () => ready);
    await waitForNativeAttach(runtime.runtimeHome, { ...immediate, discover, dispatch });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
  it.each(['permission_denied', 'invalid_response', 'transport_failed', 'timeout'] as const)(
    'does not retry sibling transport %s',
    async (code) => {
      const dispatch = vi.fn(async () => {
        throw new NativeControlError(code, 'private capability');
      });
      await expect(
        waitForNativeAttach(runtime.runtimeHome, { discover: async () => sibling, dispatch })
      ).rejects.toMatchObject({ code: 'readiness_failed' });
      expect(dispatch).toHaveBeenCalledOnce();
    }
  );
  it.each([undefined, 0, -1, 1.5, '989898'])('rejects malformed sibling pid %j', async (pid) => {
    await expect(
      waitForNativeAttach(runtime.runtimeHome, {
        discover: async () => ({ ...sibling, pid }),
        dispatch: async () => ready,
      })
    ).rejects.toMatchObject({ code: 'readiness_failed' });
  });
});

describe('attached daemon supervision', () => {
  const immediate = { delay: async () => undefined };
  it.each(['unavailable', 'disconnected'] as const)('reports owner loss on %s', async (code) => {
    const dispatch = vi.fn(async () => {
      throw new NativeControlError(code, 'private capability');
    });
    await expect(
      watchAttachedDaemon(runtime.runtimeHome, new AbortController().signal, {
        ...immediate,
        dispatch,
      })
    ).resolves.toBe('lost');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'health' }, runtime.runtimeHome);
  });
  it('reports owner loss when the daemon rejects the current capability', async () => {
    await expect(
      watchAttachedDaemon(runtime.runtimeHome, new AbortController().signal, {
        ...immediate,
        dispatch: async () => ({ ok: false, code: 'unauthorized' }),
      })
    ).resolves.toBe('lost');
  });
  it.each([
    ['timeout', () => Promise.reject(new NativeControlError('timeout', 'private capability'))],
    ['degraded health', () => Promise.resolve(startingHealth)],
  ] as const)('keeps serving after a %s probe', async (_name, first) => {
    const dispatch = vi.fn().mockImplementationOnce(first).mockRejectedValue(unavailable());
    await expect(
      watchAttachedDaemon(runtime.runtimeHome, new AbortController().signal, {
        ...immediate,
        dispatch,
      })
    ).resolves.toBe('lost');
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
  it.each(['permission_denied', 'invalid_response', 'transport_failed'] as const)(
    'fails closed on probe transport %s',
    async (code) => {
      await expect(
        watchAttachedDaemon(runtime.runtimeHome, new AbortController().signal, {
          ...immediate,
          dispatch: async () => {
            throw new NativeControlError(code, 'private capability');
          },
        })
      ).rejects.toMatchObject({ code: 'native_unhealthy', message: 'native_unhealthy' });
    }
  );
  it('fails closed on a rejected non-authentication health reply', async () => {
    await expect(
      watchAttachedDaemon(runtime.runtimeHome, new AbortController().signal, {
        ...immediate,
        dispatch: async () => ({ ok: false, code: 'invalid_config' }),
      })
    ).rejects.toMatchObject({ code: 'native_unhealthy' });
  });
  it('probes once per second with one request in flight', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const dispatch = vi.fn(async () => ready);
    const watching = watchAttachedDaemon(runtime.runtimeHome, controller.signal, { dispatch });
    await vi.advanceTimersByTimeAsync(999);
    const early = dispatch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1001);
    expect({ early, later: dispatch.mock.calls.length }).toEqual({ early: 0, later: 2 });
    controller.abort();
    expect(await watching).toBe('cancelled');
  });
  it('stops without probing once the session aborts', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const dispatch = vi.fn(async () => ready);
    const watching = watchAttachedDaemon(runtime.runtimeHome, controller.signal, { dispatch });
    controller.abort();
    expect(await watching).toBe('cancelled');
    expect({ calls: dispatch.mock.calls.length, timers: vi.getTimerCount() }).toEqual({
      calls: 0,
      timers: 0,
    });
  });
  it('settles cancelled while a probe is still in flight', async () => {
    const controller = new AbortController();
    const dispatch = vi.fn(() => new Promise<Record<string, unknown>>(() => undefined));
    const watching = watchAttachedDaemon(runtime.runtimeHome, controller.signal, {
      ...immediate,
      dispatch,
    });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    controller.abort();
    expect(await watching).toBe('cancelled');
  });
});

describe('concurrent launch election and takeover', () => {
  const immediate = { delay: async () => undefined };
  // A launch whose own daemon exits on the native instance lock held by the sibling owner.
  function losingFixture() {
    const f = fixture();
    f.dependencies.discover.mockResolvedValue(sibling);
    f.dependencies.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => f.exit(1));
      return f.child;
    });
    return f;
  }
  // A service that stays live until the test settles it or the launcher cancels it.
  function liveService(f: ReturnType<typeof fixture>) {
    let finish: () => void = () => undefined;
    f.dependencies.serve.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined);
          // Like real serve, a cancelled session settles once its input is destroyed.
          f.input.once('close', () => resolve(undefined));
        })
    );
    return () => finish();
  }
  it('serves attached through the shared runtime home after losing the election', async () => {
    const f = losingFixture();
    expect(await runStandaloneMcpb(f.options, { ...f.dependencies, ...immediate })).toBe(0);
    expect(f.dependencies.serve).toHaveBeenCalledWith(expect.anything(), f.output, {
      runtimeHome: runtime.runtimeHome,
    });
    expect(f.kill).not.toHaveBeenCalled();
  });
  it('fails closed without serving when the sibling rejects the capability', async () => {
    const f = losingFixture();
    f.dependencies.dispatch.mockResolvedValue({ ok: false, code: 'unauthorized' } as never);
    expect(await runStandaloneMcpb(f.options, { ...f.dependencies, ...immediate })).toBe(1);
    expect(f.dependencies.serve).not.toHaveBeenCalled();
  });
  it('fails closed without serving when no sibling ever answers', async () => {
    const f = losingFixture();
    f.dependencies.dispatch.mockRejectedValue(unavailable());
    expect(await runStandaloneMcpb(f.options, { ...f.dependencies, ...immediate })).toBe(1);
    expect(f.dependencies.serve).not.toHaveBeenCalled();
  });
  it('signals nothing from the exit-time fallback while attached', async () => {
    const f = losingFixture();
    const finish = liveService(f);
    const before = new Set(process.listeners('exit'));
    const running = runStandaloneMcpb(f.options, f.dependencies);
    await vi.waitFor(() => expect(f.dependencies.serve).toHaveBeenCalled());
    const added = process.listeners('exit').filter((listener) => !before.has(listener));
    for (const listener of added) (listener as () => void)();
    finish();
    expect(await running).toBe(0);
    expect(f.kill).not.toHaveBeenCalled();
  });
  it('takes ownership with a new exact child when the attached owner exits', async () => {
    const f = losingFixture();
    const finish = liveService(f);
    const successor = childFixture();
    Object.defineProperty(successor.child, 'pid', { value: 515151 });
    f.dependencies.spawn.mockImplementationOnce(() => {
      f.dependencies.discover.mockResolvedValue({ ...discovery, pid: 515151 });
      return successor.child;
    });
    f.dependencies.dispatch
      .mockResolvedValueOnce(ready)
      .mockRejectedValueOnce(unavailable())
      .mockResolvedValue(ready);
    const running = runStandaloneMcpb(f.options, { ...f.dependencies, ...immediate });
    await vi.waitFor(() => expect(f.dependencies.dispatch).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setImmediate(resolve));
    finish();
    expect(await running).toBe(0);
    expect({
      spawned: f.dependencies.spawn.mock.calls.length,
      successorSignals: successor.kill.mock.calls,
      loserSignals: f.kill.mock.calls,
    }).toEqual({ spawned: 2, successorSignals: [['SIGTERM']], loserSignals: [] });
  });
  it('reattaches without cancelling service when another sibling wins the takeover', async () => {
    const f = losingFixture();
    const finish = liveService(f);
    const loser = childFixture();
    f.dependencies.spawn.mockImplementationOnce(() => {
      f.dependencies.discover.mockResolvedValue({ ...discovery, pid: 616161 });
      queueMicrotask(() => loser.exit(1));
      return loser.child;
    });
    f.dependencies.dispatch
      .mockResolvedValueOnce(ready)
      .mockRejectedValueOnce(unavailable())
      .mockResolvedValueOnce(ready)
      .mockImplementation(() => new Promise(() => undefined));
    const running = runStandaloneMcpb(f.options, { ...f.dependencies, ...immediate });
    await vi.waitFor(() => expect(f.dependencies.dispatch).toHaveBeenCalledTimes(4));
    const serving = !f.output.destroyed;
    finish();
    expect(await running).toBe(0);
    expect({ serving, spawned: f.dependencies.spawn.mock.calls.length }).toEqual({
      serving: true,
      spawned: 2,
    });
  });
  it('fails closed after two unreachable takeover rounds', async () => {
    const f = losingFixture();
    liveService(f);
    f.dependencies.spawn.mockImplementation(() => {
      const next = childFixture();
      queueMicrotask(() => next.exit(1));
      return next.child;
    });
    f.dependencies.dispatch.mockResolvedValueOnce(ready).mockRejectedValue(unavailable());
    expect(await runStandaloneMcpb(f.options, { ...f.dependencies, ...immediate })).toBe(1);
    expect({
      spawned: f.dependencies.spawn.mock.calls.length,
      outputDestroyed: f.output.destroyed,
    }).toEqual({ spawned: 3, outputDestroyed: true });
  });
  it('fails closed when attached supervision reports an unhealthy transport', async () => {
    const f = losingFixture();
    liveService(f);
    f.dependencies.dispatch
      .mockResolvedValueOnce(ready)
      .mockRejectedValue(new NativeControlError('permission_denied', 'private capability'));
    expect(await runStandaloneMcpb(f.options, { ...f.dependencies, ...immediate })).toBe(1);
    expect(f.dependencies.spawn).toHaveBeenCalledOnce();
  });
  it('reaps an in-flight takeover child when signaled', async () => {
    const f = losingFixture();
    liveService(f);
    const successor = childFixture();
    Object.defineProperty(successor.child, 'pid', { value: 515151 });
    f.dependencies.spawn.mockImplementationOnce(() => {
      f.dependencies.discover.mockImplementation(() => new Promise(() => undefined));
      return successor.child;
    });
    f.dependencies.dispatch.mockResolvedValueOnce(ready).mockRejectedValueOnce(unavailable());
    const running = runStandaloneMcpb(f.options, { ...f.dependencies, ...immediate });
    await vi.waitFor(() => expect(f.dependencies.spawn).toHaveBeenCalledTimes(2));
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    expect({
      spawned: f.dependencies.spawn.mock.calls.length,
      successorSignals: successor.kill.mock.calls,
    }).toEqual({ spawned: 2, successorSignals: [['SIGTERM']] });
  });
});

describe('owned daemon cleanup', () => {
  it('shares one cleanup promise and signals only the supplied child once', async () => {
    const f = childFixture();
    const first = terminateOwnedDaemon(f.child);
    expect(terminateOwnedDaemon(f.child)).toBe(first);
    await first;
    expect(f.kill.mock.calls).toEqual([['SIGTERM']]);
  });
  it('does not signal an already-exited child', async () => {
    const f = childFixture();
    f.exit();
    await terminateOwnedDaemon(f.child);
    expect(f.kill).not.toHaveBeenCalled();
  });
  it('escalates after two seconds and bounds the second wait to two seconds', async () => {
    vi.useFakeTimers();
    const f = childFixture(false);
    const result = expect(terminateOwnedDaemon(f.child)).rejects.toMatchObject({
      code: 'cleanup_failed',
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(f.kill.mock.calls).toEqual([['SIGTERM']]);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    await vi.advanceTimersByTimeAsync(2000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
    f.exit();
  });
  it('reaps a child that exits after escalation without leaving timers', async () => {
    vi.useFakeTimers();
    const f = childFixture(false);
    const cleaning = terminateOwnedDaemon(f.child);
    await vi.advanceTimersByTimeAsync(2000);
    f.exit(0, 'SIGKILL');
    await cleaning;
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['throw', 'false', 'error'] as const)(
    'reports a signal %s as cleanup failure',
    async (failure) => {
      const f = childFixture(false);
      f.kill.mockImplementation(() => {
        if (failure === 'throw') throw new Error('private capability');
        queueMicrotask(() => {
          if (failure === 'error') f.child.emit('error', new Error('private capability'));
          f.exit();
        });
        return failure !== 'false';
      });
      const cleaning = terminateOwnedDaemon(f.child, { delay: async () => undefined });
      await expect(cleaning).rejects.toMatchObject({
        code: 'cleanup_failed',
        message: 'cleanup_failed',
      });
      f.exit();
    }
  );
});

describe('standalone MCP lifecycle', () => {
  it.each(['success', 'failure'] as const)(
    'lets real serve own delayed output %s after clean EOF',
    async (result) => {
      vi.useFakeTimers();
      const f = realServiceFixture();
      let returned: number | undefined;
      f.input.end(initializeFrame);
      const running = runStandaloneMcpb(f.options, f.dependencies).then((code) => {
        returned = code;
        return code;
      });
      await vi.advanceTimersByTimeAsync(0);
      const earlyResult = returned;
      f.callbacks[0]?.(result === 'failure' ? new Error('private output failure') : undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(earlyResult).toBeUndefined();
      expect(await running).toBe(result === 'success' ? 0 : 1);
      expect(f.serviceSettled()).toBe(true);
    }
  );
  it('returns failure after the real output timeout even when stdin ended cleanly', async () => {
    vi.useFakeTimers();
    const f = realServiceFixture();
    let returned: number | undefined;
    f.input.end(initializeFrame);
    const running = runStandaloneMcpb(f.options, f.dependencies).then((code) => {
      returned = code;
      return code;
    });
    await vi.advanceTimersByTimeAsync(1499);
    const earlyResult = returned;
    await vi.advanceTimersByTimeAsync(1);
    expect(earlyResult).toBeUndefined();
    expect(await running).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['signal', 'daemon_exit'] as const)(
    'settles real serve and cancels buffered output after %s',
    async (event) => {
      vi.useFakeTimers();
      const f = realServiceFixture();
      f.input.write(initializeFrame + '{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
      const running = runStandaloneMcpb(f.options, f.dependencies);
      await vi.advanceTimersByTimeAsync(0);
      if (event === 'signal') process.emit('SIGTERM');
      else f.exit();
      await vi.advanceTimersByTimeAsync(0);
      const status = await running;
      const stopped = {
        serviceSettled: f.serviceSettled(),
        destroyed: f.output.destroyed,
        timers: vi.getTimerCount(),
      };
      f.callbacks[0]?.();
      await vi.advanceTimersByTimeAsync(0);
      const frameCount = f.frames.length;
      f.callbacks[1]?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(status).toBe(event === 'signal' ? 0 : 1);
      expect(stopped).toEqual({ serviceSettled: true, destroyed: true, timers: 0 });
      expect(frameCount).toBe(1);
    }
  );
  it('fails within 1500 ms if a cancelled service refuses to settle', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let returned: number | undefined;
    f.dependencies.serve.mockImplementation(() => new Promise(() => undefined));
    const running = runStandaloneMcpb(f.options, f.dependencies).then((code) => {
      returned = code;
      return code;
    });
    await vi.advanceTimersByTimeAsync(0);
    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(1499);
    const earlyResult = returned;
    await vi.advanceTimersByTimeAsync(1);
    expect(earlyResult).toBeUndefined();
    expect(await running).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves cleanup failure after a signal interrupts preparation', async () => {
    const f = fixture();
    f.dependencies.prepareRuntime.mockImplementation(async () => {
      process.emit('SIGTERM');
      return runtime;
    });
    vi.spyOn(f.input, 'destroy').mockImplementation(() => {
      throw new Error('private capability');
    });
    expect(await runStandaloneMcpb(f.options, f.dependencies)).toBe(1);
    expect(f.dependencies.spawn).not.toHaveBeenCalled();
  });
  it('cancels readiness timers when interrupted cleanup cannot reap its child', async () => {
    vi.useFakeTimers();
    const f = fixture(false);
    f.dependencies.dispatch.mockImplementation(() => new Promise(() => undefined));
    const running = runStandaloneMcpb(f.options, f.dependencies);
    await vi.advanceTimersByTimeAsync(0);
    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(4000);
    const timers = vi.getTimerCount();
    f.exit();
    expect(await running).toBe(1);
    expect(timers).toBe(0);
  });
  it('keeps signal ownership until bounded cleanup settles', async () => {
    vi.useFakeTimers();
    const f = fixture(false);
    const baseline = process.listenerCount('SIGTERM');
    const running = runStandaloneMcpb(f.options, f.dependencies);
    await vi.advanceTimersByTimeAsync(0);
    const listenersDuringCleanup = process.listenerCount('SIGTERM');
    f.exit();
    expect(await running).toBe(0);
    expect(listenersDuringCleanup).toBe(baseline + 1);
    expect(process.listenerCount('SIGTERM')).toBe(baseline);
  });
  it.each(['input', 'output'] as const)(
    'owns %s errors during native readiness',
    async (stream) => {
      vi.useFakeTimers();
      const f = fixture();
      f[stream].on('error', () => undefined);
      f.dependencies.dispatch.mockImplementation(() => new Promise(() => undefined));
      const running = runStandaloneMcpb(f.options, f.dependencies);
      await vi.advanceTimersByTimeAsync(0);
      f[stream].emit('error', new Error('private capability'));
      await vi.advanceTimersByTimeAsync(0);
      const signals = f.kill.mock.calls.map(([signal]) => signal);
      f.exit();
      expect(await running).toBe(1);
      expect(signals).toEqual(['SIGTERM']);
    }
  );
  it('still cleans up when input destruction throws', async () => {
    const f = fixture();
    vi.spyOn(f.input, 'destroy').mockImplementation(() => {
      throw new Error('private capability');
    });
    expect(await runStandaloneMcpb(f.options, f.dependencies)).toBe(1);
    expect(f.kill.mock.calls).toEqual([['SIGTERM']]);
  });
  it('serves real MCP through clean stdin EOF and terminates its daemon', async () => {
    const f = fixture();
    const { serve } =
      require('../../src/core/mcp/server.cjs') as typeof import('../../src/core/mcp/server.cjs');
    let response = '';
    f.output.on('data', (chunk) => {
      response += chunk.toString();
    });
    f.input.end(
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}\n'
    );
    expect(await runStandaloneMcpb(f.options, { ...f.dependencies, serve })).toBe(0);
    expect(JSON.parse(response)).toMatchObject({ jsonrpc: '2.0', id: 1, result: {} });
    expect(f.kill.mock.calls).toEqual([['SIGTERM']]);
  });
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'cleans up and releases signal listeners after %s',
    async (signal) => {
      const f = fixture();
      const baseline = process.listenerCount(signal);
      f.dependencies.serve.mockImplementation(
        () => new Promise((resolve) => f.input.once('close', () => resolve(undefined)))
      );
      const running = runStandaloneMcpb(f.options, f.dependencies);
      await vi.waitFor(() => expect(f.dependencies.serve).toHaveBeenCalled());
      process.emit(signal);
      expect(await running).toBe(0);
      expect(f.kill.mock.calls).toEqual([['SIGTERM']]);
      expect(process.listenerCount(signal)).toBe(baseline);
    }
  );
  it('cleans up immediately if signaled during readiness', async () => {
    const f = fixture();
    f.dependencies.dispatch.mockImplementation(() => new Promise(() => undefined));
    const running = runStandaloneMcpb(f.options, f.dependencies);
    await vi.waitFor(() => expect(f.dependencies.dispatch).toHaveBeenCalled());
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    expect(f.kill.mock.calls).toEqual([['SIGTERM']]);
    expect(f.dependencies.serve).not.toHaveBeenCalled();
  });
  it('cleans up and fails closed on server rejection', async () => {
    const f = fixture();
    f.dependencies.serve.mockRejectedValue(new Error('private capability'));
    expect(await runStandaloneMcpb(f.options, f.dependencies)).toBe(1);
    expect(f.kill.mock.calls).toEqual([['SIGTERM']]);
  });
  it('cleans up after readiness failure without serving MCP', async () => {
    const f = fixture();
    f.dependencies.dispatch.mockRejectedValue(
      new NativeControlError('timeout', 'private capability')
    );
    expect(await runStandaloneMcpb(f.options, f.dependencies)).toBe(1);
    expect(f.kill.mock.calls).toEqual([['SIGTERM']]);
    expect(f.dependencies.serve).not.toHaveBeenCalled();
  });
  it('fails and closes input after a post-readiness daemon exit', async () => {
    const f = fixture();
    f.dependencies.serve.mockImplementation(
      () => new Promise((resolve) => f.input.once('close', () => resolve(undefined)))
    );
    const running = runStandaloneMcpb(f.options, f.dependencies);
    await vi.waitFor(() => expect(f.dependencies.serve).toHaveBeenCalled());
    f.exit();
    expect(await running).toBe(1);
    expect(f.input.destroyed).toBe(true);
    expect(f.kill).not.toHaveBeenCalled();
  });
  it('upgrades clean server completion when cleanup fails', async () => {
    const f = fixture(false);
    expect(
      await runStandaloneMcpb(f.options, { ...f.dependencies, delay: async () => undefined })
    ).toBe(1);
    expect(f.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    f.exit();
  });
});

describe('standalone CLI pipes', () => {
  it('routes bare run to the real MCP handshake from an unrelated cwd', () => {
    const result = invokeEntry('real', true);
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(
      result.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).toMatchObject([
      { id: 1, result: { protocolVersion: '2025-11-25' } },
      { id: 2, result: { tools: [{ name: 'krypton_read_file' }, { name: 'krypton_write_file' }] } },
    ]);
    expect(result.signals).toBe('SIGTERM\n');
  }, 30000);
  it('fails startup under strict unhandled rejection handling and reaps its owned daemon', () => {
    const result = invokeEntry('readiness-failure');
    expect({ status: result.status, stdout: result.stdout, signals: result.signals }).toEqual({
      status: 1,
      stdout: '',
      signals: 'SIGTERM\n',
    });
    expect(result.stderr).toBe('[KRYPTON] operation_failed; command failed closed.\n');
  }, 30000);
});

import { ChildProcess, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { NativeControlError } =
  require('../../src/core/processIsolation.cjs') as typeof import('../../src/core/processIsolation.cjs');
import type { LauncherDependencies, LauncherOptions } from '../../src/packaging/launch_mcpb.cjs';
const {
  runStandaloneMcpb,
  waitForNativeReady: nativeReadiness,
  terminateOwnedDaemon,
} = require('../../src/packaging/launch_mcpb.cjs') as typeof import('../../src/packaging/launch_mcpb.cjs');

const launcherPath = path.resolve('src/packaging/launch_mcpb.cjs');
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

// Preload replaces only destructive boundaries in an owned disposable Node process.
function invokeEntry(serverBody: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krypton-launcher-test-'));
  const preload = path.join(root, 'preload.cjs');
  const signals = path.join(root, 'signals');
  const sourceRoot = path.resolve('src');
  try {
    fs.writeFileSync(
      preload,
      `
      const fs = require('node:fs');
      const cp = require('node:child_process');
      const child = new cp.ChildProcess();
      Object.defineProperty(child, 'pid', { value: 424242 });
      child.kill = (signal) => {
        fs.appendFileSync(${JSON.stringify(signals)}, signal + '\\n');
        child.signalCode = signal;
        queueMicrotask(() => { child.emit('exit', null, signal); child.emit('close', null, signal); });
        return true;
      };
      process.kill = () => { throw new Error('arbitrary PID signaling forbidden'); };
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      Object.defineProperty(process, 'arch', { value: 'arm64' });
      cp.spawn = () => child;
      require(${JSON.stringify(path.join(sourceRoot, 'packaging/mcpb_runtime.cjs'))}).prepareStandaloneRuntime = async () => (${JSON.stringify(runtime)});
      require(${JSON.stringify(path.join(sourceRoot, 'core/processIsolation.cjs'))}).dispatchNativeControl = async () => (${JSON.stringify(ready)});
      require(${JSON.stringify(path.join(sourceRoot, 'core/processIsolation.cjs'))}).discoverNativeEndpoint = async () => (${JSON.stringify(discovery)});
      require(${JSON.stringify(path.join(sourceRoot, 'core/mcp/server.cjs'))}).serve = async () => { ${serverBody} };
    `
    );
    const result = spawnSync(
      process.execPath,
      ['--unhandled-rejections=strict', '--require', preload, launcherPath],
      {
        encoding: 'utf8',
        timeout: 5000,
        cwd: root,
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

describe('standalone launcher entry boundary', () => {
  it('redacts an arbitrary server failure through the shared CLI boundary', () => {
    const result = invokeEntry("throw new Error('private capability /private/workspace');");
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('[KRYPTON] operation_failed; command failed closed.\n');
    expect({ stdout: result.stdout, signals: result.signals }).toEqual({
      stdout: '',
      signals: 'SIGTERM\n',
    });
  });
  it.each(['stdout', 'stderr'])(
    'uses only exact-child synchronous fallback when %s fails',
    (stream) => {
      const result = invokeEntry(
        `process.${stream}.emit('error', new Error('private capability'));`
      );
      expect(result.status).toBe(1);
      expect({ stdout: result.stdout, stderr: result.stderr }).toEqual({ stdout: '', stderr: '' });
      expect(result.signals).toBe('SIGKILL\n');
    }
  );
  it('rejects CLI arguments before launching any runtime', () => {
    const result = spawnSync(process.execPath, [launcherPath, 'unexpected'], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, KRYPTON_PROJECT_ROOT: '/missing-private-workspace' },
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('invalid_usage');
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
      version: '1.0.0',
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
    expect(f.dependencies.serve).toHaveBeenCalledWith(f.input, f.output, {
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
  it('stops concurrent-instance waiting on owned-child exit without signaling discovery', async () => {
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
    expect(await running).toBe(1);
    expect(waitingCalls).toBe(2);
    expect({
      health: f.dependencies.dispatch.mock.calls.length,
      served: f.dependencies.serve.mock.calls.length,
      ownedSignals: f.kill.mock.calls,
      otherSignals: other.kill.mock.calls,
      timers: vi.getTimerCount(),
    }).toEqual({ health: 0, served: 0, ownedSignals: [], otherSignals: [], timers: 0 });
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
    expect(
      await runStandaloneMcpb(owned.options, {
        ...owned.dependencies,
        delay: async () => undefined,
      })
    ).toBe(1);
    expect({
      served: owned.dependencies.serve.mock.calls.length,
      ownedSignals: owned.kill.mock.calls,
      otherSignals: other.kill.mock.calls,
    }).toEqual({ served: 0, ownedSignals: [['SIGTERM']], otherSignals: [] });
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

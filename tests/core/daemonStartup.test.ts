import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureNativeDaemon, STARTUP_BUDGET_MS } from '../../src/core/daemonStartup.cjs';
import type { DaemonStartupDependencies } from '../../src/core/daemonStartup.cjs';
const { NativeControlError } =
  require('../../src/core/processIsolation.cjs') as typeof import('../../src/core/processIsolation.cjs');

let root: string;
const healthy = { ok: true, health: { status: 'healthy' } };
const unavailable = () => new NativeControlError('unavailable', 'unavailable');
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp('/tmp/krypton-startup-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
async function binary(relative = 'src/core-native/target/release') {
  const directory = path.join(root, relative);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'krypton-core-native');
  await fs.writeFile(file, 'fixture only', { mode: 0o700 });
  return file;
}
function fixture() {
  const host = new EventEmitter() as ChildProcess;
  Object.assign(host, { pid: 62001, exitCode: null, signalCode: null, unref: vi.fn() });
  const close = () => {
    Object.assign(host, { exitCode: 0 });
    host.emit('close', 0, null);
  };
  host.kill = vi.fn(() => {
    queueMicrotask(close);
    return true;
  });
  const spawnHost = vi.fn<NonNullable<DaemonStartupDependencies['spawn']>>(() => host);
  const dispatch = vi.fn().mockResolvedValue(healthy).mockRejectedValueOnce(unavailable());
  const signals = new EventEmitter();
  return {
    host,
    close,
    workspace: { repositoryRoot: root, projectRoot: root, cwd: root },
    deps: { spawn: spawnHost, dispatch, signals, targetDirectory: '' },
  };
}

describe('source daemon startup', () => {
  it('reuses healthy authenticated service without inspecting files or spawning', async () => {
    const f = fixture();
    f.deps.dispatch.mockReset().mockResolvedValue(healthy);
    await ensureNativeDaemon(f.workspace, f.deps);
    expect(f.deps.spawn).not.toHaveBeenCalled();
    expect(await fs.readdir(root)).toEqual([]);
  });
  it.each([
    'permission_denied',
    'invalid_response',
    'timeout',
    'disconnected',
    'transport_failed',
  ] as const)('does not start over a %s failure', async (code) => {
    const f = fixture();
    f.deps.dispatch.mockReset().mockRejectedValue(new NativeControlError(code, 'redacted'));
    await expect(ensureNativeDaemon(f.workspace, f.deps)).rejects.toHaveProperty('code', code);
    expect(f.deps.spawn).not.toHaveBeenCalled();
  });
  it('does not replace degraded service', async () => {
    const f = fixture();
    f.deps.dispatch.mockReset().mockResolvedValue({ ok: true, health: { status: 'degraded' } });
    await expect(ensureNativeDaemon(f.workspace, f.deps)).rejects.toHaveProperty(
      'code',
      'daemon_unhealthy'
    );
    expect(f.deps.spawn).not.toHaveBeenCalled();
  });
  it('reports a missing build before changing runtime state', async () => {
    const f = fixture();
    await expect(ensureNativeDaemon(f.workspace, f.deps)).rejects.toHaveProperty(
      'code',
      'binary_missing'
    );
    expect(f.deps.spawn).not.toHaveBeenCalled();
    expect(await fs.readdir(root)).toEqual([]);
  });
  it.each([
    'target/release',
    'src/core-native/target/release',
    'target/debug',
    'src/core-native/target/debug',
    'custom/release',
  ])('starts a detached host using %s and private managed logs', async (relative) => {
    const executable = await binary(relative);
    const f = fixture();
    if (relative.startsWith('custom')) f.deps.targetDirectory = 'custom';
    await ensureNativeDaemon(f.workspace, f.deps);
    expect(f.deps.spawn).toHaveBeenCalledWith(
      process.execPath,
      [path.resolve('src/core/daemonHost.cjs'), executable],
      {
        cwd: root,
        detached: true,
        shell: false,
        stdio: ['ignore', 'ignore', 'ignore', expect.any(Number)],
      }
    );
    expect((await fs.stat(path.join(root, '.krypton/logs/daemon.log'))).mode & 0o777).toBe(0o600);
    expect(f.host.unref).toHaveBeenCalledOnce();
  });
  it('prefers a release binary over a debug build', async () => {
    await binary('target/debug');
    const release = await binary();
    const f = fixture();
    await ensureNativeDaemon(f.workspace, f.deps);
    expect(f.deps.spawn.mock.calls[0]?.[1]?.[1]).toBe(release);
  });
  it('rejects a writable executable without starting', async () => {
    await fs.chmod(await binary(), 0o777);
    const f = fixture();
    await expect(ensureNativeDaemon(f.workspace, f.deps)).rejects.toHaveProperty(
      'code',
      'binary_unsafe'
    );
    expect(f.deps.spawn).not.toHaveBeenCalled();
  });
  it.each(['symlink-directory', 'symlink-file', 'public-file', 'hardlink-file'])(
    'refuses unsafe managed log state: %s',
    async (kind) => {
      await binary();
      await fs.mkdir(path.join(root, '.krypton'), { mode: 0o700 });
      const logs = path.join(root, '.krypton/logs');
      const external = path.join(root, 'untouched');
      await fs.writeFile(external, 'preserve', { mode: 0o600 });
      if (kind === 'symlink-directory') await fs.symlink(root, logs);
      else {
        await fs.mkdir(logs, { mode: 0o700 });
        const log = path.join(logs, 'daemon.log');
        if (kind === 'symlink-file') await fs.symlink(external, log);
        else if (kind === 'hardlink-file') await fs.link(external, log);
        else await fs.writeFile(log, 'public', { mode: 0o644 });
      }
      const f = fixture();
      await expect(ensureNativeDaemon(f.workspace, f.deps)).rejects.toHaveProperty(
        'code',
        'log_unavailable'
      );
      expect(f.deps.spawn).not.toHaveBeenCalled();
      expect(await fs.readFile(external, 'utf8')).toBe('preserve');
    }
  );
  it('reuses the winner when a simultaneous native startup loses its lock', async () => {
    await binary();
    const f = fixture();
    f.deps.spawn.mockImplementation(() => {
      queueMicrotask(f.close);
      return f.host;
    });
    await ensureNativeDaemon(f.workspace, f.deps);
    expect(f.host.kill).not.toHaveBeenCalled();
  });
  it('gives each starter a separate log inode while retaining only the latest path', async () => {
    await binary();
    const first = fixture();
    await ensureNativeDaemon(first.workspace, first.deps);
    const logPath = path.join(root, '.krypton/logs/daemon.log');
    // Holding this descriptor models the duplicate inherited by the first host.
    const held = await fs.open(logPath, 'r+');
    try {
      await held.writeFile('first');
      const second = fixture();
      await ensureNativeDaemon(second.workspace, second.deps);
      await fs.writeFile(logPath, 'second');
      await held.write(Buffer.from('-more'));
      const bytes = Buffer.alloc(10);
      await held.read(bytes, 0, bytes.length, 0);
      expect(bytes.toString()).toBe('first-more');
      expect(await fs.readFile(logPath, 'utf8')).toBe('second');
      expect(await fs.readdir(path.dirname(logPath))).toEqual(['daemon.log']);
    } finally {
      await held.close();
    }
  });
  it('preserves the previous log and cleans staging state when publication fails', async () => {
    await binary();
    const f = fixture();
    await ensureNativeDaemon(f.workspace, f.deps);
    const logPath = path.join(root, '.krypton/logs/daemon.log');
    await fs.writeFile(logPath, 'preserve');
    const next = fixture();
    const injectedFs = { ...fs, rename: vi.fn().mockRejectedValue(new Error('private path')) };
    await expect(
      ensureNativeDaemon(next.workspace, { ...next.deps, fs: injectedFs })
    ).rejects.toHaveProperty('code', 'log_unavailable');
    expect(await fs.readFile(logPath, 'utf8')).toBe('preserve');
    expect(await fs.readdir(path.dirname(logPath))).toEqual(['daemon.log']);
  });
  it('removes staging even when its descriptor close reports failure', async () => {
    await binary();
    const f = fixture();
    const open: typeof fs.open = async (...args) => {
      const handle = await fs.open(...args);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
        await close();
        throw new Error('private close failure');
      });
      return handle;
    };
    const injectedFs = {
      ...fs,
      open,
      rename: vi.fn().mockRejectedValue(new Error('private rename failure')),
    };
    await expect(
      ensureNativeDaemon(f.workspace, { ...f.deps, fs: injectedFs })
    ).rejects.toHaveProperty('code', 'cleanup_failed');
    expect(await fs.readdir(path.join(root, '.krypton/logs'))).toEqual([]);
    expect(f.deps.spawn).not.toHaveBeenCalled();
  });
  it('never removes an unowned staging path when exclusive creation fails', async () => {
    await binary();
    const f = fixture();
    const injectedFs = {
      ...fs,
      open: vi.fn().mockRejectedValue(Object.assign(new Error('collision'), { code: 'EEXIST' })),
      unlink: vi.fn(),
    };
    await expect(
      ensureNativeDaemon(f.workspace, { ...f.deps, fs: injectedFs })
    ).rejects.toHaveProperty('code', 'log_unavailable');
    expect(injectedFs.unlink).not.toHaveBeenCalled();
  });
  it('reports a typed cleanup failure when staging unlink is denied', async () => {
    await binary();
    const f = fixture();
    const injectedFs = {
      ...fs,
      rename: vi.fn().mockRejectedValue(new Error('private rename failure')),
      unlink: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('private unlink failure'), { code: 'EACCES' })),
    };
    await expect(
      ensureNativeDaemon(f.workspace, { ...f.deps, fs: injectedFs })
    ).rejects.toHaveProperty('code', 'cleanup_failed');
    expect(f.deps.spawn).not.toHaveBeenCalled();
  });
  it.each(['false', 'throw', 'timeout'])(
    'unreferences its host and clears timers after shutdown %s',
    async (mode) => {
      await binary();
      const f = fixture();
      f.host.kill = vi.fn(() => {
        if (mode === 'throw') throw new Error('private signal failure');
        return mode !== 'false';
      });
      f.deps.dispatch.mockResolvedValue({ ok: true, health: { status: 'degraded' } });
      const timers = new Set<ReturnType<typeof setTimeout>>();
      await expect(
        ensureNativeDaemon(f.workspace, {
          ...f.deps,
          setTimer: (callback, milliseconds) => {
            const handle = setTimeout(callback, milliseconds);
            timers.add(handle);
            if (milliseconds === 4000) queueMicrotask(callback);
            return handle;
          },
          clearTimer: (handle) => {
            clearTimeout(handle);
            if (handle) timers.delete(handle);
          },
        })
      ).rejects.toHaveProperty('code', 'cleanup_failed');
      expect(f.host.unref).toHaveBeenCalledOnce();
      expect(timers.size).toBe(0);
    }
  );
  it.each(['resolve', 'reject'])(
    'deadline interrupts a stalled health probe before late %s and clears timers',
    async (settlement) => {
      await binary();
      const f = fixture();
      let settle: (() => void) | undefined;
      let ready: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        ready = resolve;
      });
      f.deps.dispatch
        .mockImplementationOnce(() => Promise.reject(unavailable()))
        .mockImplementation(
          () =>
            new Promise((resolve, reject) => {
              settle = () =>
                settlement === 'resolve'
                  ? resolve(healthy)
                  : reject(new Error('private late failure'));
              ready?.();
            })
        );
      let expire: (() => void) | undefined;
      const timers = new Set<ReturnType<typeof setTimeout>>();
      const pending = ensureNativeDaemon(f.workspace, {
        ...f.deps,
        setTimer: (callback: () => void, ms: number) => {
          if (ms === STARTUP_BUDGET_MS) expire = callback;
          const handle = setTimeout(callback, ms);
          timers.add(handle);
          return handle;
        },
        clearTimer: (handle) => {
          clearTimeout(handle);
          if (handle) timers.delete(handle);
        },
      }).then(
        () => 'unexpected success',
        (error: unknown) => error
      );
      try {
        await started;
        expire?.();
        expect(await pending).toHaveProperty('code', 'startup_timeout');
        expect(f.host.kill).toHaveBeenCalledWith('SIGTERM');
        expect(timers.size).toBe(0);
      } finally {
        settle?.();
        await pending;
      }
    }
  );
  it('stops its host on shutdown during readiness', async () => {
    await binary();
    const f = fixture();
    f.deps.dispatch
      .mockImplementationOnce(() => Promise.reject(unavailable()))
      .mockImplementation(async () => {
        f.deps.signals.emit('SIGTERM');
        throw unavailable();
      });
    await expect(ensureNativeDaemon(f.workspace, f.deps)).rejects.toHaveProperty(
      'code',
      'startup_cancelled'
    );
    expect(f.host.kill).toHaveBeenCalledWith('SIGTERM');
    expect(f.deps.signals.listenerCount('SIGTERM')).toBe(0);
  });
  it('owns asynchronous spawn errors without leaking a log handle', async () => {
    await binary();
    const f = fixture();
    f.deps.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        f.host.emit('error', new Error('private'));
        f.close();
      });
      return f.host;
    });
    await expect(ensureNativeDaemon(f.workspace, f.deps)).rejects.toHaveProperty(
      'code',
      'startup_failed'
    );
    expect(f.host.listenerCount('error')).toBe(1);
  });
});

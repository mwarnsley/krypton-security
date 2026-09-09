import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { main, parseInvocation } from '../../src/core/supervisor.cjs';
import type { ProtectedProcessOutcome } from '../../src/core/processIsolation.cjs';

const workspace = {
  projectRoot: '/workspace',
  cwd: '/workspace/sandbox_workspace',
  repositoryRoot: '/workspace',
};
const identity = { pid: 62001, parentPid: 4000, startTime: 100, executablePath: '/usr/bin/node' };
const outcome: ProtectedProcessOutcome = {
  code: 0,
  signal: null,
  identity,
  spawnError: undefined,
  registrationError: undefined,
  exitedBeforeRegistrationFailure: false,
  enforcementConfirmed: false,
  cleanupFailed: false,
  childMayBeRunning: false,
};
function fixture(result = outcome) {
  const child = Object.assign(new EventEmitter(), {
    pid: identity.pid,
    kill: vi.fn(),
    exitCode: null,
    signalCode: null,
  });
  const stderr = vi.fn();
  const signals = new EventEmitter();
  const start = vi.fn().mockReturnValue({
    child,
    registered: Promise.resolve(identity),
    completed: Promise.resolve(result),
  });
  const dispatch = vi
    .fn()
    .mockResolvedValue({ ok: true, code: 'ready', health: { status: 'healthy' } });
  return {
    child,
    start,
    stderr,
    signals,
    dispatch,
    resolveWorkspace: vi.fn().mockResolvedValue(workspace),
    platform: 'darwin',
  };
}

describe('supervisor arguments', () => {
  it('routes setup without requiring daemon discovery or spawning an agent', async () => {
    const deps = fixture();
    const setup = vi.fn().mockResolvedValue(0);
    expect(await main(['setup'], { ...deps, setup })).toBe(0);
    expect(setup).toHaveBeenCalledWith([]);
    expect(deps.resolveWorkspace).not.toHaveBeenCalled();
  });
  it('preserves literal arguments including spaces, shell operators and a second separator', () => {
    expect(parseInvocation(['run', '--', 'node', 'a b', '$(whoami)', ';', '--'])).toEqual({
      type: 'run',
      command: 'node',
      args: ['a b', '$(whoami)', ';', '--'],
    });
  });
  it.each([
    [],
    ['run'],
    ['run', 'node'],
    ['run', '--'],
    ['run', '--', ''],
    ['run', '--', 'node', '\0'],
    ['daemon:start', 'extra'],
    ['setup', 'extra'],
  ])('rejects invalid invocation %j', (...args) => {
    expect(() => parseInvocation(args as string[])).toThrow();
  });
  it('recognizes daemon:start without shell parsing', () => {
    expect(parseInvocation(['daemon:start'])).toEqual({ type: 'daemon:start' });
  });
});

describe('supervisor runtime', () => {
  it('checks daemon health before directly spawning with inherited stdio', async () => {
    const deps = fixture();
    await main(['run', '--', 'node', 'a b'], deps);
    expect(deps.dispatch.mock.invocationCallOrder[0]).toBeLessThan(
      deps.start.mock.invocationCallOrder[0]!
    );
    expect(deps.start).toHaveBeenCalledWith(
      'node',
      ['a b'],
      { cwd: workspace.cwd, stdio: 'inherit', shell: false },
      expect.objectContaining({ dispatch: expect.any(Function) })
    );
  });
  it('does not spawn when daemon discovery or authentication fails', async () => {
    const deps = fixture();
    deps.dispatch.mockRejectedValue(new Error('never print a capability'));
    expect(await main(['run', '--', 'node'], deps)).toBe(1);
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.stderr).toHaveBeenCalledWith(
      "Krypton native daemon is not running. Please start it with 'npm run dev:full' or 'krypton daemon:start'.\n"
    );
  });
  it.each([0, 7, 127])('preserves child exit code %s', async (code) => {
    expect(await main(['run', '--', 'node'], fixture({ ...outcome, code }))).toBe(code);
  });
  it('keeps a successful MCP session free of supervisor diagnostics', async () => {
    const deps = fixture();
    await main(['run', '--', 'node'], deps);
    expect(deps.stderr).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'attributes SIGKILL only with a confirmed receipt: %s',
    async (enforcementConfirmed) => {
      const deps = fixture({ ...outcome, code: null, signal: 'SIGKILL', enforcementConfirmed });
      expect(await main(['run', '--', 'node'], deps)).toBe(137);
      expect(deps.stderr).toHaveBeenCalledWith(
        enforcementConfirmed
          ? `[KRYPTON] Process ${identity.pid} terminated by native security boundary enforcement.\n`
          : `[KRYPTON] Process ${identity.pid} exited via SIGKILL; enforcement attribution is unconfirmed.\n`
      );
    }
  );
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'forwards %s to only the owned child and removes signal listeners',
    async (signal) => {
      const deps = fixture();
      let finish!: (result: ProtectedProcessOutcome) => void;
      deps.start.mockReturnValue({
        child: deps.child,
        registered: Promise.resolve(identity),
        completed: new Promise((resolve) => {
          finish = resolve;
        }),
      });
      const running = main(['run', '--', 'node'], deps);
      await vi.waitFor(() => expect(deps.start).toHaveBeenCalled());
      deps.signals.emit(signal);
      finish({ ...outcome, code: null, signal });
      expect(await running).toBe(signal === 'SIGINT' ? 130 : 143);
      expect(deps.child.kill).toHaveBeenCalledWith(signal);
      expect(deps.signals.listenerCount(signal)).toBe(0);
    }
  );
  it('returns setup failure after rejected live registration', async () => {
    expect(
      await main(
        ['run', '--', 'node'],
        fixture({
          ...outcome,
          registrationError: new Error('denied'),
          code: null,
          signal: 'SIGKILL',
        })
      )
    ).toBe(1);
  });
  it('preserves an early exit while reporting incomplete registration', async () => {
    const deps = fixture({
      ...outcome,
      code: 4,
      registrationError: new Error('already gone'),
      exitedBeforeRegistrationFailure: true,
    });
    expect(await main(['run', '--', 'node'], deps)).toBe(4);
    expect(deps.stderr).toHaveBeenCalledWith(
      expect.stringContaining('before registration completed')
    );
  });
  it('reports failed owned-child termination without claiming it stopped', async () => {
    const deps = fixture({
      ...outcome,
      childMayBeRunning: true,
      registrationError: new Error('denied'),
    });
    expect(await main(['run', '--', 'node'], deps)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(expect.stringContaining('child may still be running'));
  });
  it('rejects unsupported native platforms without spawning', async () => {
    const deps = fixture();
    expect(await main(['run', '--', 'node'], { ...deps, platform: 'win32' })).toBe(1);
    expect(deps.start).not.toHaveBeenCalled();
  });
});

describe('supervisor failure diagnostics', () => {
  it('returns nonzero when registration failed after a zero child exit', async () => {
    const deps = fixture({
      ...outcome,
      registrationError: new Error('denied'),
      exitedBeforeRegistrationFailure: true,
    });
    expect(await main(['run', '--', 'node'], deps)).toBe(1);
  });
  it('returns nonzero when unregister failed after a zero child exit', async () => {
    const deps = fixture({ ...outcome, cleanupFailed: true });
    expect(await main(['run', '--', 'node'], deps)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(expect.stringContaining('unregister'));
  });
  it('handles a rejected setup without leaking raw errors', async () => {
    const deps = fixture();
    expect(
      await main(['setup'], { ...deps, setup: vi.fn().mockRejectedValue(new Error('secret')) })
    ).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(expect.stringContaining('Setup failed'));
  });
  it('handles unexpected lifecycle rejection on stderr and removes listeners', async () => {
    const deps = fixture();
    deps.start.mockImplementation(() => ({
      child: deps.child,
      registered: Promise.resolve(identity),
      completed: Promise.reject(new Error('secret')),
    }));
    expect(await main(['run', '--', 'node'], deps)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(expect.stringContaining('Supervision failed'));
    expect(deps.signals.listenerCount('SIGINT')).toBe(0);
  });
});

describe('daemon startup errors', () => {
  it('reports a missing cargo executable on stderr and returns failure', async () => {
    const access = vi.spyOn(fs, 'access').mockResolvedValue(undefined);
    const deps = fixture();
    const spawn = vi.fn().mockImplementation(() => {
      queueMicrotask(() =>
        deps.child.emit('error', Object.assign(new Error('secret'), { code: 'ENOENT' }))
      );
      return deps.child;
    });
    try {
      expect(await main(['daemon:start'], { ...deps, spawn })).toBe(1);
      expect(deps.stderr).toHaveBeenCalledWith(expect.stringContaining('Install rustup/cargo'));
      expect(deps.signals.listenerCount('SIGTERM')).toBe(0);
    } finally {
      access.mockRestore();
    }
  });
});

describe('supervisor failure classification', () => {
  it.each([
    ['EPERM', 'permission_denied'],
    ['ENOENT', 'unavailable'],
  ])('classifies %s workspace failures safely', async (code, category) => {
    const deps = fixture();
    deps.resolveWorkspace.mockRejectedValue(Object.assign(new Error('secret-path'), { code }));
    expect(await main(['run', '--', 'node'], deps)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(`[KRYPTON] Failure category: ${category}.\n`);
  });
  it('records unknown thrown values as unexpected failures', async () => {
    const deps = fixture();
    expect(await main(['setup'], { ...deps, setup: vi.fn().mockRejectedValue(null) })).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith('[KRYPTON] Failure category: unexpected_failure.\n');
  });
});

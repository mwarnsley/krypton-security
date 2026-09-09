import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  quarantineProcess,
  registerWorkspaceProcess,
  spawnProtectedProcess,
  type ProcessIdentityPayload,
} from '../../src/core/processIsolation.cjs';
const identity = {
  executablePath: '/usr/bin/node',
  parentPid: 4000,
  pid: 62001,
  startTime: 1784500000,
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('native-only isolation', () => {
  it.each([0, -1, 1.5, NaN, 4242])('rejects legacy registration %s', (pid) => {
    expect(() => registerWorkspaceProcess(pid)).toThrow();
  });
  it('rejects PID-only isolation without any signal or dispatch', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const dispatch = vi.fn();
    await expect(
      quarantineProcess(4242 as unknown as ProcessIdentityPayload, { dispatch })
    ).rejects.toThrow('complete process identity');
    expect(kill).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('dispatches the complete identity to the native daemon', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true, code: 'process_isolated' });
    await quarantineProcess(identity, { dispatch });
    expect(dispatch).toHaveBeenCalledWith({ type: 'isolate_process', process: identity });
  });
  it.each(['audit_only', 'stale_process_identity', 'process_not_registered', 'unauthorized'])(
    'propagates native rejection %s',
    async (code) => {
      const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
      await expect(
        quarantineProcess(identity, { dispatch: vi.fn().mockResolvedValue({ ok: false, code }) })
      ).rejects.toThrow(code);
      expect(kill).not.toHaveBeenCalled();
    }
  );
});
describe('protected child lifecycle', () => {
  it('registers and unregisters the exact child generation', async () => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), pid: identity.pid });
    const dispatch = vi.fn().mockResolvedValue({ ok: true, code: 'process_registered' });
    await spawnProtectedProcess(
      'node',
      [],
      {},
      { spawn: () => child, inspect: async () => identity, dispatch }
    );
    expect(dispatch).toHaveBeenCalledWith({ type: 'register_process', process: identity });
    child.emit('exit', 0);
    await vi.waitFor(() =>
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'unregister_process', process: identity })
    );
  });
  it('cleans up only the owned child on failed registration', async () => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), pid: identity.pid });
    await expect(
      spawnProtectedProcess(
        'node',
        [],
        {},
        {
          spawn: () => child,
          inspect: async () => identity,
          dispatch: vi.fn().mockResolvedValue({ ok: false, code: 'unauthorized' }),
        }
      )
    ).rejects.toThrow('registration');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
  it('uses authenticated isolation rather than child.kill for runtime deadlines', async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), pid: identity.pid });
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, code: 'process_registered' })
      .mockResolvedValue({ ok: true, code: 'process_isolated' });
    await spawnProtectedProcess(
      'node',
      [],
      { maxRuntimeMs: 20 },
      { spawn: () => child, inspect: async () => identity, dispatch }
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'isolate_process', process: identity });
    expect(child.kill).not.toHaveBeenCalled();
    child.emit('exit', 0);
  });
});

describe('supervisor lifecycle completion', () => {
  it('captures an exit while registration is pending and unregisters once', async () => {
    const { startProtectedProcess } = await import('../../src/core/processIsolation.cjs');
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), pid: identity.pid });
    let acknowledge!: (value: Record<string, unknown>) => void;
    const dispatch = vi.fn().mockImplementation((command: { type: string }) =>
      command.type === 'register_process'
        ? new Promise((resolve) => {
            acknowledge = resolve;
          })
        : Promise.resolve({ ok: true, code: 'process_unregistered' })
    );
    const handle = startProtectedProcess(
      'node',
      [],
      {},
      {
        spawn: () => child,
        inspect: async () => identity,
        dispatch,
      }
    );
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    child.emit('exit', 7, null);
    acknowledge({ ok: true, code: 'process_registered' });
    expect((await handle.completed).code).toBe(7);
    expect(
      dispatch.mock.calls.filter(([command]) => command.type === 'unregister_process')
    ).toHaveLength(1);
  });

  it.each([true, false])(
    'requires a positive receipt for SIGKILL attribution: %s',
    async (confirmed) => {
      const { startProtectedProcess } = await import('../../src/core/processIsolation.cjs');
      const child = Object.assign(new EventEmitter(), { kill: vi.fn(), pid: identity.pid });
      const dispatch = vi.fn().mockImplementation(async (command: { type: string }) => ({
        ok: true,
        code:
          command.type === 'register_process'
            ? 'process_registered'
            : command.type === 'termination_receipt'
              ? confirmed
                ? 'process_isolated'
                : 'termination_unconfirmed'
              : 'process_unregistered',
      }));
      const handle = startProtectedProcess(
        'node',
        [],
        {},
        {
          spawn: () => child,
          inspect: async () => identity,
          dispatch,
        }
      );
      await handle.registered;
      child.emit('exit', null, 'SIGKILL');
      expect((await handle.completed).enforcementConfirmed).toBe(confirmed);
      expect(dispatch).toHaveBeenCalledWith({ type: 'termination_receipt', process: identity });
    }
  );

  it('settles a spawn error without an unhandled error event', async () => {
    const { startProtectedProcess } = await import('../../src/core/processIsolation.cjs');
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), pid: undefined });
    const dispatch = vi.fn();
    const handle = startProtectedProcess('missing', [], {}, { spawn: () => child, dispatch });
    child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(handle.registered).rejects.toThrow();
    expect((await handle.completed).spawnError).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('reaps the owned child and attempts unregister after registration rejection', async () => {
    const { startProtectedProcess } = await import('../../src/core/processIsolation.cjs');
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), pid: identity.pid });
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit('exit', null, 'SIGKILL'));
      return true;
    });
    const dispatch = vi.fn().mockResolvedValue({ ok: false, code: 'unauthorized' });
    const handle = startProtectedProcess(
      'node',
      [],
      {},
      {
        spawn: () => child,
        inspect: async () => identity,
        dispatch,
      }
    );
    await expect(handle.registered).rejects.toThrow('registration');
    expect((await handle.completed).enforcementConfirmed).toBe(false);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});

describe('failed owned-child cleanup', () => {
  it('reports a child that could not be stopped without waiting indefinitely', async () => {
    const { startProtectedProcess } = await import('../../src/core/processIsolation.cjs');
    const child = Object.assign(new EventEmitter(), {
      kill: vi.fn().mockReturnValue(false),
      unref: vi.fn(),
      pid: identity.pid,
    });
    const dispatch = vi.fn().mockResolvedValue({ ok: false, code: 'unauthorized' });
    const session = startProtectedProcess(
      'node',
      [],
      {},
      { spawn: () => child, inspect: async () => identity, dispatch }
    );
    const result = await session.completed;
    expect(result.childMayBeRunning).toBe(true);
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'unregister_process', process: identity });
    expect(child.unref).toHaveBeenCalled();
  });
});

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
    await Promise.resolve();
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'unregister_process', process: identity });
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

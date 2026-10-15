import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
const { startProtectedProcess, NativeControlError } =
  require('../../src/core/processIsolation.cjs') as typeof import('../../src/core/processIsolation.cjs');

const identity = { pid: 62001, parentPid: 4000, startTime: 100, executablePath: '/usr/bin/node' };
function fixture() {
  const child = Object.assign(new EventEmitter(), {
    pid: identity.pid,
    kill: vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
      queueMicrotask(() => child.emit('exit', null, signal));
      return true;
    }),
  });
  const dispatch = vi.fn(async (command: Record<string, unknown>) => ({
    ok: true,
    code: command.type === 'register_process' ? 'process_registered' : 'process_unregistered',
  }));
  const inspect = vi.fn().mockResolvedValue(identity);
  const recoverRegistration = vi.fn().mockResolvedValue(undefined);
  const controller = new AbortController();
  const deps = {
    spawn: () => child,
    dispatch,
    inspect,
    recoverRegistration,
    signal: controller.signal,
  };
  return { child, deps, controller };
}

describe('bounded registration reconnection', () => {
  it.each(['unavailable', 'disconnected'] as const)(
    'recovers once after %s without killing the child',
    async (code) => {
      const f = fixture();
      f.deps.dispatch.mockRejectedValueOnce(new NativeControlError(code, 'redacted'));
      const session = startProtectedProcess('node', [], {}, f.deps);
      await expect(session.registered).resolves.toEqual(identity);
      expect(f.deps.recoverRegistration).toHaveBeenCalledOnce();
      expect(f.deps.inspect).toHaveBeenCalledTimes(2);
      expect(f.child.kill).not.toHaveBeenCalled();
      f.child.emit('exit', 0, null);
      expect(await session.completed).toMatchObject({
        registrationError: undefined,
        cleanupFailed: false,
      });
      expect(f.deps.dispatch.mock.calls.map(([command]) => command)).toEqual([
        { type: 'register_process', process: identity },
        { type: 'register_process', process: identity },
        { type: 'unregister_process', process: identity },
      ]);
    }
  );

  it('stops after a second disconnect and still attempts exact-generation cleanup', async () => {
    const f = fixture();
    f.deps.dispatch.mockRejectedValue(new NativeControlError('disconnected', 'redacted'));
    const session = startProtectedProcess('node', [], {}, f.deps);
    expect(await session.completed).toMatchObject({
      registrationError: { code: 'disconnected' },
      cleanupFailed: true,
    });
    expect(f.deps.recoverRegistration).toHaveBeenCalledOnce();
    expect(
      f.deps.dispatch.mock.calls.filter(([command]) => command.type === 'register_process')
    ).toHaveLength(2);
    expect(f.child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it.each(['permission_denied', 'invalid_response', 'timeout', 'transport_failed'] as const)(
    'does not recover %s',
    async (code) => {
      const f = fixture();
      f.deps.dispatch.mockRejectedValueOnce(new NativeControlError(code, 'redacted'));
      const session = startProtectedProcess('node', [], {}, f.deps);
      expect(await session.completed).toMatchObject({
        registrationError: { code },
        cleanupFailed: false,
      });
      expect(f.deps.recoverRegistration).not.toHaveBeenCalled();
    }
  );

  it.each([
    'unauthorized',
    'stale_process_identity',
    'process_identity_mismatch',
    'process_already_registered',
  ])('does not restart the daemon after native rejection %s', async (code) => {
    const f = fixture();
    f.deps.dispatch.mockResolvedValueOnce({ ok: false, code });
    const session = startProtectedProcess('node', [], {}, f.deps);
    expect((await session.completed).registrationError).toBeInstanceOf(Error);
    expect(f.deps.recoverRegistration).not.toHaveBeenCalled();
  });

  it.each(['identity', 'shutdown', 'exit', 'health'] as const)(
    'does not re-register after recovery encounters %s',
    async (failure) => {
      const f = fixture();
      f.deps.dispatch.mockRejectedValueOnce(new NativeControlError('disconnected', 'redacted'));
      f.deps.recoverRegistration.mockImplementation(async () => {
        if (failure === 'identity')
          f.deps.inspect.mockResolvedValue({ ...identity, startTime: 101 });
        if (failure === 'shutdown') f.controller.abort();
        if (failure === 'exit') f.child.emit('exit', 0, null);
        if (failure === 'health') throw new Error('degraded');
      });
      const session = startProtectedProcess('node', [], {}, f.deps);
      expect((await session.completed).registrationError).toBeInstanceOf(Error);
      expect(f.deps.recoverRegistration).toHaveBeenCalledOnce();
      expect(
        f.deps.dispatch.mock.calls.filter(([command]) => command.type === 'register_process')
      ).toHaveLength(1);
    }
  );
});

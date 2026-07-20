import { EventEmitter } from 'node:events';
import { describe, expect, it, test, vi } from 'vitest';

import {
  getActiveWorkspaceProcessCount,
  registerWorkspaceProcess,
  spawnProtectedProcess,
  unregisterWorkspaceProcess,
} from '../../src/core/processIsolation.cjs';

describe('process isolation registry', () => {
  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid process ID %s',
    (pid) => {
      expect(() => registerWorkspaceProcess(pid)).toThrow(RangeError);
    }
  );

  it('registers and unregisters a valid process ID', () => {
    registerWorkspaceProcess(61_001);

    expect(() => unregisterWorkspaceProcess(61_001)).not.toThrow();
  });

  it('handles duplicate process registration idempotently', () => {
    try {
      registerWorkspaceProcess(61_002);

      expect(() => registerWorkspaceProcess(61_002)).not.toThrow();
    } finally {
      unregisterWorkspaceProcess(61_002);
    }
  });

  it('reports the live number of registered process IDs', () => {
    try {
      registerWorkspaceProcess(61_003);

      expect(getActiveWorkspaceProcessCount()).toBe(1);
    } finally {
      unregisterWorkspaceProcess(61_003);
    }
  });
});

describe('protected native child lifecycle', () => {
  it('registers the compound identity before returning the child', async () => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), pid: 62_001 });
    const identity = {
      executablePath: '/usr/bin/node',
      parentPid: process.pid,
      pid: 62_001,
      startTime: 1_784_500_000,
    };
    const dispatch = vi.fn().mockResolvedValue({ code: 'process_registered', ok: true });

    await spawnProtectedProcess(
      'node',
      ['agent.js'],
      {},
      {
        dispatch,
        inspect: vi.fn().mockResolvedValue(identity),
        spawn: vi.fn(() => child),
      }
    );

    expect(dispatch).toHaveBeenCalledWith({ process: identity, type: 'register_process' });
  });

  it('unregisters the exact generation once when the child exits', async () => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), pid: 62_002 });
    const identity = {
      executablePath: '/usr/bin/node',
      parentPid: process.pid,
      pid: 62_002,
      startTime: 1_784_500_001,
    };
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({ code: 'process_registered', ok: true })
      .mockResolvedValueOnce({ code: 'process_unregistered', ok: true });
    await spawnProtectedProcess(
      'node',
      [],
      {},
      {
        dispatch,
        inspect: vi.fn().mockResolvedValue(identity),
        spawn: vi.fn(() => child),
      }
    );
    child.emit('exit', 0);
    child.emit('error', new Error('duplicate terminal event'));
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith({ process: identity, type: 'unregister_process' });
  });

  it('kills the owned child when native registration fails closed', async () => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), pid: 62_003 });
    await expect(
      spawnProtectedProcess(
        'node',
        [],
        {},
        {
          dispatch: vi.fn().mockResolvedValue({ code: 'unauthorized', ok: false }),
          inspect: vi.fn().mockResolvedValue({
            executablePath: '/usr/bin/node',
            parentPid: process.pid,
            pid: 62_003,
            startTime: 1_784_500_002,
          }),
          spawn: vi.fn(() => child),
        }
      )
    ).rejects.toThrow('rejected child-process registration');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    destroy: vi.fn(),
    end: vi.fn((payload: string) => {
      const request = JSON.parse(payload) as { requestId: string };
      queueMicrotask(() => {
        handlers.get('data')?.(
          JSON.stringify({
            code: 'ready',
            health: {
              ipc: 'ready',
              ledger: 'ready',
              mode: 'audit_only',
              status: 'healthy',
              watcher: 'ready',
            },
            ok: true,
            protocolVersion: 1,
            requestId: request.requestId,
          })
        );
        handlers.get('end')?.();
        handlers.get('close')?.(false);
      });
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return socket;
    }),
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return socket;
    }),
    removeAllListeners: vi.fn(() => socket),
    setEncoding: vi.fn(() => socket),
    setTimeout: vi.fn(() => socket),
  };
  return {
    createConnection: vi.fn(() => {
      queueMicrotask(() => handlers.get('connect')?.());
      return socket;
    }),
    handlers,
    readFile: vi.fn(),
    socket,
  };
});

vi.mock('node:fs', () => ({ promises: { readFile: nativeMocks.readFile } }));
vi.mock('node:net', () => ({ createConnection: nativeMocks.createConnection }));

import { dispatchNativeCommand } from './nativeClient';

beforeEach(() => {
  vi.clearAllMocks();
  nativeMocks.handlers.clear();
  nativeMocks.readFile
    .mockResolvedValueOnce(
      JSON.stringify({
        capabilityFile: '/runtime/capability',
        endpoint: '/runtime/daemon.sock',
        pid: 100,
        protocolVersion: 1,
        startedAt: '2026-07-19T00:00:00.000Z',
      })
    )
    .mockResolvedValueOnce('a'.repeat(64));
});

describe('native control client', () => {
  it('uses the workspace-specific Unix-domain socket', async () => {
    await dispatchNativeCommand({ type: 'health' });
    expect(nativeMocks.createConnection).toHaveBeenCalledWith('/runtime/daemon.sock');
  });

  it('writes a versioned capability-authenticated request', async () => {
    await dispatchNativeCommand({ enabled: true, type: 'set_audit_mode' });
    const payload = nativeMocks.socket.end.mock.calls[0]?.[0] as string;
    expect(JSON.parse(payload)).toEqual(
      expect.objectContaining({
        capability: 'a'.repeat(64),
        command: { enabled: true, type: 'set_audit_mode' },
        protocolVersion: 1,
      })
    );
  });

  it('settles once when end and close both fire', async () => {
    await expect(dispatchNativeCommand({ type: 'health' })).resolves.toEqual(
      expect.objectContaining({ code: 'ready', ok: true })
    );
    expect(nativeMocks.socket.destroy).toHaveBeenCalledOnce();
  });

  it('rejects oversized native responses', async () => {
    nativeMocks.socket.end.mockImplementationOnce(() => {
      queueMicrotask(() => nativeMocks.handlers.get('data')?.('x'.repeat(16 * 1024 + 1)));
    });
    await expect(dispatchNativeCommand({ type: 'health' })).rejects.toThrow('oversized');
  });
});

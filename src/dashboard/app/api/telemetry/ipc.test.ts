import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const netMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...arguments_: unknown[]) => void>();
  const socket = {
    destroy: vi.fn(),
    end: vi.fn(() => {
      queueMicrotask(() => {
        handlers.get('data')?.('SUCCESS: AUDIT_MODE_UPDATED\n');
        handlers.get('end')?.();
      });
    }),
    on: vi.fn((eventName: string, handler: (...arguments_: unknown[]) => void) => {
      handlers.set(eventName, handler);
      return socket;
    }),
    once: vi.fn((eventName: string, handler: (...arguments_: unknown[]) => void) => {
      handlers.set(eventName, handler);
      return socket;
    }),
    setEncoding: vi.fn(() => socket),
    setTimeout: vi.fn(() => socket),
  };

  return { createConnection: vi.fn(), handlers, socket };
});

vi.mock('node:net', () => ({
  createConnection: netMocks.createConnection,
}));

import { dispatchNativeCommand, isNativeDaemonReachable } from './ipc';

beforeEach(() => {
  netMocks.handlers.clear();
  netMocks.createConnection.mockImplementation(() => {
    queueMicrotask(() => netMocks.handlers.get('connect')?.());
    return netMocks.socket;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('dispatchNativeCommand', () => {
  it('uses only the fixed loopback native endpoint', async () => {
    await dispatchNativeCommand('TOGGLE_AUDIT_MODE:true');

    expect(netMocks.createConnection).toHaveBeenCalledWith({ host: '127.0.0.1', port: 9000 });
  });

  it('writes the exact command and returns the trimmed receipt', async () => {
    const receipt = await dispatchNativeCommand('TOGGLE_AUDIT_MODE:true');

    expect(netMocks.socket.end).toHaveBeenCalledWith('TOGGLE_AUDIT_MODE:true', 'utf8');
    expect(receipt).toBe('SUCCESS: AUDIT_MODE_UPDATED');
  });
});

describe('isNativeDaemonReachable', () => {
  it('recognizes the exact native health receipt', async () => {
    netMocks.socket.end.mockImplementationOnce(() => {
      queueMicrotask(() => {
        netMocks.handlers.get('data')?.('SUCCESS: DAEMON_READY\n');
        netMocks.handlers.get('end')?.();
      });
    });

    await expect(isNativeDaemonReachable()).resolves.toBe(true);
  });

  it('fails closed when the daemon connection emits an error', async () => {
    netMocks.createConnection.mockImplementationOnce(() => {
      queueMicrotask(() => netMocks.handlers.get('error')?.(new Error('connection refused')));
      return netMocks.socket;
    });

    await expect(isNativeDaemonReachable()).resolves.toBe(false);
  });
});

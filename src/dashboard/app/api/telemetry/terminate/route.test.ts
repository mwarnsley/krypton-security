import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';

const netMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...arguments_: unknown[]) => void>();
  let nextReceipt = 'SUCCESS: PID_ISOLATED\n';
  const socket = {
    destroy: vi.fn(),
    end: vi.fn(() => {
      queueMicrotask(() => {
        handlers.get('data')?.(nextReceipt);
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

  return {
    createConnection: vi.fn(),
    handlers,
    setNextReceipt(receipt: string) {
      nextReceipt = receipt;
    },
    socket,
  };
});

vi.mock('node:net', () => ({
  createConnection: netMocks.createConnection,
}));

import { POST } from './route';

const TERMINATE_ENDPOINT = 'http://localhost/api/telemetry/terminate';
const ROUTE_LOG_PREFIX = '[API /api/telemetry/terminate]';

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

/**
 * Creates one dashboard isolation request fixture.
 *
 * @param {string} body - The raw JSON request body.
 * @returns {Request} The POST request passed to the route handler.
 * @complexity O(L) time and space for body length L.
 * @example
 * createRequest('{"targetProcessId":4242}');
 * // => Request
 */
function createRequest(body: string): Request {
  return new Request(TERMINATE_ENDPOINT, {
    body,
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  netMocks.handlers.clear();
  netMocks.setNextReceipt('SUCCESS: PID_ISOLATED\n');
  netMocks.createConnection.mockImplementation(() => {
    queueMicrotask(() => netMocks.handlers.get('connect')?.());
    return netMocks.socket;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('telemetry termination route', () => {
  test.each([{}, { pid: 4242 }, { targetPid: 4242 }, null, []])(
    'rejects payload without targetProcessId %#',
    async (payload) => {
      const response = await POST(createRequest(JSON.stringify(payload)));

      expect(response.status).toBe(400);
    }
  );

  it('logs the exact key missing from frontend payloads', async () => {
    await POST(createRequest(JSON.stringify({ pid: 4242, targetPid: 4242 })));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `${ROUTE_LOG_PREFIX} Missing required keys: targetProcessId.`
    );
  });

  it('logs targetProcessId as missing for malformed JSON', async () => {
    const response = await POST(createRequest('not-json'));

    expect(response.status).toBe(400);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `${ROUTE_LOG_PREFIX} Missing required keys: targetProcessId. Request body is not valid JSON.`
    );
  });

  test.each([
    { targetProcessId: null },
    { targetProcessId: '4242' },
    { targetProcessId: 0 },
    { targetProcessId: -1 },
    { targetProcessId: 1.5 },
    { targetProcessId: 4_294_967_296 },
  ])('rejects invalid targetProcessId payload %#', async (payload) => {
    const response = await POST(createRequest(JSON.stringify(payload)));

    expect(response.status).toBe(400);
  });

  it('logs present but invalid parameter keys precisely', async () => {
    await POST(createRequest(JSON.stringify({ targetProcessId: '4242' })));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `${ROUTE_LOG_PREFIX} Missing required keys: none. Invalid keys: targetProcessId.`
    );
  });

  it('rejects the dashboard server process ID before opening a socket', async () => {
    const response = await POST(createRequest(JSON.stringify({ targetProcessId: process.pid })));

    expect(response.status).toBe(400);
    expect(netMocks.createConnection).not.toHaveBeenCalled();
  });

  it('connects only to the native loopback listener', async () => {
    await POST(createRequest(JSON.stringify({ targetProcessId: 4242 })));

    expect(netMocks.createConnection).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 9000,
    });
  });

  it('writes the exact Rust isolation command and closes the socket', async () => {
    await POST(createRequest(JSON.stringify({ targetProcessId: 4242 })));

    expect(netMocks.socket.end).toHaveBeenCalledWith('ISOLATE:4242', 'utf8');
  });

  it('returns the native dispatch confirmation', async () => {
    const response = await POST(createRequest(JSON.stringify({ targetProcessId: 4242 })));
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      message: 'Target child process successfully verified and isolated.',
    });
  });

  it('returns forbidden when Rust rejects an unowned PID', async () => {
    netMocks.setNextReceipt('ERROR: PID_NOT_OWNED\n');

    const response = await POST(createRequest(JSON.stringify({ targetProcessId: 4242 })));
    const body: unknown = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      success: false,
      message: 'Isolation rejected: target process is not an authorized Krypton workspace child.',
    });
  });

  it('returns conflict when audit-only mode suppresses isolation', async () => {
    netMocks.setNextReceipt('ERROR: AUDIT_ONLY\n');

    const response = await POST(createRequest(JSON.stringify({ targetProcessId: 4242 })));
    const body: unknown = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      success: false,
      message: 'Isolation is disabled while Audit-Only Mode is active.',
    });
  });

  it('rejects unexpected native execution receipts', async () => {
    netMocks.setNextReceipt('ERROR: ISOLATION_FAILED\n');

    const response = await POST(createRequest(JSON.stringify({ targetProcessId: 4242 })));

    expect(response.status).toBe(502);
  });

  it('rejects oversized native execution receipts', async () => {
    netMocks.setNextReceipt('x'.repeat(65));

    const response = await POST(createRequest(JSON.stringify({ targetProcessId: 4242 })));

    expect(response.status).toBe(502);
    expect(netMocks.socket.destroy).toHaveBeenCalledOnce();
  });

  it('returns a gateway error when the native daemon is unavailable', async () => {
    netMocks.createConnection.mockImplementationOnce(() => {
      queueMicrotask(() => netMocks.handlers.get('error')?.(new Error('connection refused')));
      return netMocks.socket;
    });

    const response = await POST(createRequest(JSON.stringify({ targetProcessId: 4242 })));

    expect(response.status).toBe(502);
  });

  it('destroys timed-out sockets and returns a gateway error', async () => {
    netMocks.createConnection.mockImplementationOnce(() => {
      queueMicrotask(() => netMocks.handlers.get('timeout')?.());
      return netMocks.socket;
    });

    const response = await POST(createRequest(JSON.stringify({ targetProcessId: 4242 })));

    expect(response.status).toBe(502);
    expect(netMocks.socket.destroy).toHaveBeenCalledOnce();
  });
});

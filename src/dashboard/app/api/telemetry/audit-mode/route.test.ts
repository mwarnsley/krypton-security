import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';

const ipcMocks = vi.hoisted(() => ({
  dispatchNativeCommand: vi.fn(),
}));

vi.mock('../ipc', () => ipcMocks);

import { POST } from './route';

const AUDIT_MODE_ENDPOINT = 'http://localhost/api/telemetry/audit-mode';

/**
 * Creates one dashboard audit-mode request fixture.
 *
 * @param {string} body - The raw JSON request body.
 * @returns {Request} The POST request passed to the route handler.
 * @complexity O(L) time and space for body length L.
 * @example
 * createRequest('{"auditOnly":true}');
 * // => Request
 */
function createRequest(body: string): Request {
  return new Request(AUDIT_MODE_ENDPOINT, {
    body,
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  ipcMocks.dispatchNativeCommand.mockResolvedValue('SUCCESS: AUDIT_MODE_UPDATED');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('telemetry audit-mode route', () => {
  test.each([{}, { auditOnly: 'true' }, { auditOnly: 1 }, null, []])(
    'rejects invalid auditOnly payload %#',
    async (payload) => {
      const response = await POST(createRequest(JSON.stringify(payload)));

      expect(response.status).toBe(400);
    }
  );

  it('rejects malformed JSON before native IPC dispatch', async () => {
    const response = await POST(createRequest('not-json'));

    expect(response.status).toBe(400);
    expect(ipcMocks.dispatchNativeCommand).not.toHaveBeenCalled();
  });

  test.each([
    [true, 'TOGGLE_AUDIT_MODE:true'],
    [false, 'TOGGLE_AUDIT_MODE:false'],
  ])('dispatches the exact boolean command for auditOnly=%s', async (auditOnly, command) => {
    await POST(createRequest(JSON.stringify({ auditOnly })));

    expect(ipcMocks.dispatchNativeCommand).toHaveBeenCalledWith(command);
  });

  it('returns the confirmed active audit state', async () => {
    const response = await POST(createRequest(JSON.stringify({ auditOnly: true })));
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      auditOnly: true,
      message: 'Audit-Only Mode enabled.',
    });
  });

  it('rejects an unexpected native receipt', async () => {
    ipcMocks.dispatchNativeCommand.mockResolvedValueOnce('ERROR: MODE_UPDATE_FAILED');

    const response = await POST(createRequest(JSON.stringify({ auditOnly: true })));

    expect(response.status).toBe(502);
  });

  it('returns a gateway error when the native daemon is unavailable', async () => {
    ipcMocks.dispatchNativeCommand.mockRejectedValueOnce(new Error('connection refused'));

    const response = await POST(createRequest(JSON.stringify({ auditOnly: true })));

    expect(response.status).toBe(502);
  });
});

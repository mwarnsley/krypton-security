import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipcMocks = vi.hoisted(() => ({ dispatchNativeCommand: vi.fn() }));
vi.mock('../../../../server/telemetry/nativeClient', () => ipcMocks);

import { POST } from './route';

function request(body: string): Request {
  return new Request('http://localhost/api/telemetry/audit-mode', { body, method: 'POST' });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  ipcMocks.dispatchNativeCommand.mockResolvedValue({ code: 'audit_mode_updated', ok: true });
});

describe('audit mode route', () => {
  it('rejects malformed JSON', async () => {
    expect((await POST(request('nope'))).status).toBe(400);
  });

  it('dispatches the authenticated structured command', async () => {
    await POST(request('{"auditOnly":false}'));
    expect(ipcMocks.dispatchNativeCommand).toHaveBeenCalledWith({
      enabled: false,
      type: 'set_audit_mode',
    });
  });

  it('returns the confirmed mode', async () => {
    expect((await POST(request('{"auditOnly":true}'))).status).toBe(200);
  });

  it('fails closed on a native rejection', async () => {
    ipcMocks.dispatchNativeCommand.mockResolvedValue({ code: 'unauthorized', ok: false });
    expect((await POST(request('{"auditOnly":true}'))).status).toBe(502);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipcMocks = vi.hoisted(() => ({ dispatchNativeCommand: vi.fn() }));
vi.mock('../../../../server/telemetry/nativeClient', () => ipcMocks);

import { POST } from './route';

const PROCESS = {
  executablePath: '/usr/bin/node',
  parentPid: 4000,
  pid: 4242,
  startTime: 1_784_500_000,
} as const;

function request(body: string): Request {
  return new Request('http://localhost/api/telemetry/terminate', { body, method: 'POST' });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  ipcMocks.dispatchNativeCommand.mockResolvedValue({ code: 'process_isolated', ok: true });
});

describe('telemetry termination route', () => {
  it('rejects PID-only requests', async () => {
    expect((await POST(request('{"targetProcessId":4242}'))).status).toBe(400);
  });

  it('dispatches the exact compound process generation', async () => {
    await POST(request(JSON.stringify({ process: PROCESS })));
    expect(ipcMocks.dispatchNativeCommand).toHaveBeenCalledWith({
      process: PROCESS,
      type: 'isolate_process',
    });
  });

  it('returns native isolation success', async () => {
    expect((await POST(request(JSON.stringify({ process: PROCESS })))).status).toBe(200);
  });

  it('rejects an unregistered identity', async () => {
    ipcMocks.dispatchNativeCommand.mockResolvedValue({ code: 'process_not_registered', ok: false });
    expect((await POST(request(JSON.stringify({ process: PROCESS })))).status).toBe(403);
  });

  it('rejects a stale generation', async () => {
    ipcMocks.dispatchNativeCommand.mockResolvedValue({ code: 'stale_process_identity', ok: false });
    expect((await POST(request(JSON.stringify({ process: PROCESS })))).status).toBe(403);
  });

  it('honors authenticated audit-only mode', async () => {
    ipcMocks.dispatchNativeCommand.mockResolvedValue({ code: 'audit_only', ok: false });
    expect((await POST(request(JSON.stringify({ process: PROCESS })))).status).toBe(409);
  });
});

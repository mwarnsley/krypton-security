import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverMocks = vi.hoisted(() => ({
  queryNativeHealth: vi.fn(),
  readLedgerPage: vi.fn(),
}));

vi.mock('../../../server/telemetry/nativeClient', () => ({
  queryNativeHealth: serverMocks.queryNativeHealth,
}));
vi.mock('../../../server/telemetry/ledgerReader', () => ({
  readLedgerPage: serverMocks.readLedgerPage,
}));

import { GET } from './route';

const HEALTHY = {
  activeProcessCount: 2,
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
  requestId: 'health-1',
} as const;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  serverMocks.queryNativeHealth.mockResolvedValue(HEALTHY);
  serverMocks.readLedgerPage.mockResolvedValue({ alerts: [], hasMore: false, nextAfter: 12 });
});

describe('telemetry route', () => {
  it('returns one explicit native envelope', async () => {
    const response = await GET();
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        activeProcessCount: 2,
        nativeDaemonReachable: true,
        source: 'native',
        nextAfter: 12,
      })
    );
  });

  it('sets no-store caching on every successful response', async () => {
    const response = await GET();
    expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0');
  });

  it('identifies an unreachable daemon distinctly', async () => {
    serverMocks.queryNativeHealth.mockRejectedValue(new Error('unreachable'));
    const body = await (await GET()).json();
    expect(body).toEqual(
      expect.objectContaining({
        fallbackReason: 'daemon_unreachable',
        nativeDaemonReachable: false,
        source: 'mock',
      })
    );
  });

  it('identifies degraded native health distinctly', async () => {
    serverMocks.queryNativeHealth.mockResolvedValue({
      ...HEALTHY,
      health: { ...HEALTHY.health, ledger: 'write_failed', status: 'degraded' },
    });
    const body = await (await GET()).json();
    expect(body).toEqual(
      expect.objectContaining({
        fallbackReason: 'native_degraded',
        nativeDaemonReachable: true,
        source: 'mock',
      })
    );
  });

  it('identifies invalid ledger data distinctly', async () => {
    serverMocks.readLedgerPage.mockRejectedValue(new TypeError('invalid'));
    const body = await (await GET()).json();
    expect(body).toEqual(expect.objectContaining({ fallbackReason: 'ledger_invalid' }));
  });

  it('identifies an unavailable ledger distinctly', async () => {
    serverMocks.readLedgerPage.mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    );
    const body = await (await GET()).json();
    expect(body).toEqual(expect.objectContaining({ fallbackReason: 'ledger_unavailable' }));
  });

  it('clamps pagination and forwards a valid cursor', async () => {
    await GET(new Request('http://localhost/api/telemetry?after=42&limit=99999'));
    expect(serverMocks.readLedgerPage).toHaveBeenCalledWith(42, 250);
  });

  it('uses safe pagination defaults for malformed input', async () => {
    await GET(new Request('http://localhost/api/telemetry?after=-1&limit=nope'));
    expect(serverMocks.readLedgerPage).toHaveBeenCalledWith(undefined, 100);
  });
});

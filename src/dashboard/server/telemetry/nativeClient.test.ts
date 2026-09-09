import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMocks = vi.hoisted(() => ({ dispatch: vi.fn(), discover: vi.fn() }));
vi.mock('../../../core/processIsolation.cjs', () => ({
  dispatchNativeControl: nativeMocks.dispatch,
  discoverNativeEndpoint: nativeMocks.discover,
}));
import { dispatchNativeCommand, discoverNativeEndpoint, queryNativeHealth } from './nativeClient';

beforeEach(() => {
  vi.clearAllMocks();
  nativeMocks.dispatch.mockResolvedValue({
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
    requestId: 'fake-request',
  });
});

describe('native control client', () => {
  it('reports a missing registry count as degraded rather than zero', async () => {
    const response = await queryNativeHealth();
    expect(response.activeProcessCount).toBeUndefined();
    expect(response.health).toMatchObject({ registry: 'degraded', status: 'degraded' });
  });
  it('uses the bounded authenticated transport bound to the workspace', async () => {
    await dispatchNativeCommand({ enabled: true, type: 'set_audit_mode' });
    expect(nativeMocks.dispatch).toHaveBeenCalledWith(
      { enabled: true, type: 'set_audit_mode' },
      process.cwd()
    );
  });
  it.each(['timeout', 'unavailable', 'disconnected'])(
    'propagates typed %s failures',
    async (code) => {
      nativeMocks.dispatch.mockRejectedValue(
        Object.assign(new Error('Safe native failure'), { code })
      );
      await expect(dispatchNativeCommand({ type: 'health' })).rejects.toMatchObject({ code });
    }
  );
  it.each([
    null,
    { ok: true, code: 'ready' },
    { ok: true, code: 'ready', protocolVersion: 1, requestId: 'fake', activeProcessCount: -1 },
  ])('rejects invalid native response %j', async (value) => {
    nativeMocks.dispatch.mockResolvedValue(value);
    await expect(dispatchNativeCommand({ type: 'health' })).rejects.toThrow();
  });
  it('requires valid native health', async () => {
    nativeMocks.dispatch.mockResolvedValue({
      ok: true,
      code: 'ready',
      protocolVersion: 1,
      requestId: 'fake',
      health: {},
    });
    await expect(queryNativeHealth()).rejects.toThrow('health');
  });
  it('validates shared discovery metadata', async () => {
    nativeMocks.discover.mockResolvedValue(null);
    await expect(discoverNativeEndpoint()).rejects.toThrow('discovery');
  });
});

import { describe, expect, it, test } from 'vitest';
import { normalizeNativeHealth } from './nativeHealth';

const healthy = {
  status: 'healthy',
  mode: 'active_enforcement',
  ipc: 'ready',
  ledger: 'ready',
  watcher: 'ready',
  registry: 'ready',
  notification: 'ready',
  telemetryQueue: 'ready',
};

describe('native health validation', () => {
  it('preserves enforcing mode and complete readiness', () => {
    expect(normalizeNativeHealth(healthy)).toEqual(healthy);
  });
  test.each(['ipc', 'ledger', 'watcher', 'registry', 'notification', 'telemetryQueue'])(
    'does not hide %s failure',
    (component) => {
      expect(normalizeNativeHealth({ ...healthy, [component]: 'degraded' })?.status).toBe(
        'degraded'
      );
    }
  );
  it('does not invent readiness for missing components', () => {
    expect(normalizeNativeHealth({ status: 'healthy', mode: 'audit_only' })?.status).toBe(
      'degraded'
    );
  });
  it('retains unknown mode as degraded', () => {
    expect(normalizeNativeHealth({ ...healthy, mode: null })).toMatchObject({
      mode: null,
      status: 'degraded',
    });
  });
  test.each([null, {}, { ...healthy, mode: 'invented' }, { ...healthy, ipc: 'invented' }])(
    'rejects malformed health %j',
    (value) => {
      expect(normalizeNativeHealth(value)).toBeUndefined();
    }
  );
});

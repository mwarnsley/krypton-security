import type { NativeComponentHealth, NativeDaemonHealth } from '../types';

/**
 * Validates daemon health without turning absent component evidence into readiness.
 * @param {unknown} value - Untrusted native health object.
 * @returns {NativeDaemonHealth | undefined} Validated health, or undefined for malformed input.
 * @complexity O(1) time and space for the fixed component set.
 * @example
 * normalizeNativeHealth({}); // => undefined
 */
export function normalizeNativeHealth(value: unknown): NativeDaemonHealth | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const allowed = new Set<unknown>(['ready', 'write_failed', 'starting', 'degraded']);
  if (
    (record.status !== 'healthy' && record.status !== 'degraded') ||
    (record.mode !== null && record.mode !== 'audit_only' && record.mode !== 'active_enforcement')
  )
    return undefined;
  const components = [
    'ipc',
    'ledger',
    'watcher',
    'registry',
    'notification',
    'telemetryQueue',
  ] as const;
  const statuses = components.map((name) => record[name] ?? 'starting');
  if (!statuses.every((status) => allowed.has(status))) return undefined;
  const component = (name: (typeof components)[number]): NativeComponentHealth =>
    (record[name] ?? 'starting') as NativeComponentHealth;
  return {
    ipc: component('ipc'),
    ledger: component('ledger'),
    watcher: component('watcher'),
    registry: component('registry'),
    notification: component('notification'),
    telemetryQueue: component('telemetryQueue'),
    mode: record.mode,
    status:
      record.status === 'healthy' &&
      record.mode !== null &&
      statuses.every((status) => status === 'ready')
        ? 'healthy'
        : 'degraded',
  };
}

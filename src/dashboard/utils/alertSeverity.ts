import type { SecurityAlert, TelemetrySeverity } from '../types';

export type AlertSeverityCounts = Readonly<Record<TelemetrySeverity, number>>;

/** Shared semantic severity treatments for alert-table badges. */
export const ALERT_SEVERITY_CLASSES: Readonly<Record<TelemetrySeverity, string>> = {
  critical: 'border-krypton-alert-rose/40 bg-krypton-alert-rose/10 text-krypton-alert-rose',
  high: 'border-krypton-warning-amber/40 bg-krypton-warning-amber/10 text-krypton-warning-amber',
  medium:
    'border-krypton-severity-medium/40 bg-krypton-severity-medium/10 text-krypton-severity-medium',
  low: 'border-krypton-severity-low/40 bg-krypton-severity-low/10 text-krypton-severity-low',
  info: 'border-krypton-accent-cyan/40 bg-krypton-accent-cyan/10 text-krypton-accent-cyan',
};

/** Counts validated, retained events in O(n) time and O(1) auxiliary space. */
export function countAlertSeverities(
  alerts: readonly Pick<SecurityAlert, 'severity'>[]
): AlertSeverityCounts {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const alert of alerts) counts[alert.severity] += 1;
  return counts;
}

/** Invalid counts remain explicitly unavailable rather than displaying misleading numbers. */
export function formatAlertCount(count: number): {
  readonly display: string;
  readonly exact: string;
} {
  if (!Number.isSafeInteger(count) || count < 0)
    return { display: 'Unavailable', exact: 'Unavailable' };
  const exact = new Intl.NumberFormat('en-US').format(count);
  return {
    exact,
    display:
      count >= 10000
        ? new Intl.NumberFormat('en-US', { notation: 'compact' }).format(count)
        : exact,
  };
}

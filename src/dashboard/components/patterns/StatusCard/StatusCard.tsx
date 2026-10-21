import clsx from 'clsx';
import type { ReactNode } from 'react';

import { formatAlertCount, type AlertSeverityCounts } from '../../../utils';

import { InfoTooltip } from '../InfoTooltip';

import { version } from '../../../../../package.json';

export type SystemStatus = 'degraded' | 'offline' | 'operational';

export interface StatusCardProps {
  /** The number of agent child processes currently monitored by Krypton. */
  readonly activeProcessCount: number | null;

  /** Count in the current retained alert list, not a lifetime ledger total. */
  readonly alertCount: number;

  /** Per-severity counts from the same retained list as alertCount. */
  readonly severityCounts: AlertSeverityCounts;

  /** Optional runtime controls, rendered below the metric in a separated footer. */
  readonly controls?: ReactNode;

  /** The current global health state of the Krypton watchdog runtime. */
  readonly systemStatus: SystemStatus;
}

const SYSTEM_STATUS_LABELS: Readonly<Record<SystemStatus, string>> = {
  degraded: 'Degraded',
  offline: 'Offline',
  operational: 'Operational',
};

export function StatusCard(props: StatusCardProps): React.JSX.Element {
  const { activeProcessCount, alertCount, severityCounts, controls, systemStatus } = props;
  const { display: displayAlertCount, exact: exactAlertCount } = formatAlertCount(alertCount);

  return (
    <section
      aria-label="System status"
      className="flex h-full w-full min-w-0 flex-col justify-between gap-krypton-space-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-5 shadow-xl shadow-krypton-shadow"
      data-status={systemStatus}
    >
      <header className="flex flex-wrap items-center justify-between gap-krypton-space-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-krypton-heading text-krypton-accent-cyan">
            Runtime boundary
          </p>
          <h2 className="mt-1 text-lg font-bold text-krypton-fg-primary">Watchdog status</h2>
        </div>
        <strong
          aria-live="polite"
          className={clsx(
            'inline-flex rounded-krypton-radius-full border px-krypton-space-3 py-krypton-space-1 text-xs font-bold uppercase tracking-wider',
            systemStatus === 'operational' &&
              'border-krypton-success/40 bg-krypton-success/10 text-krypton-success',
            systemStatus === 'degraded' &&
              'border-krypton-warning-amber/40 bg-krypton-warning-amber/10 text-krypton-warning-foreground',
            systemStatus === 'offline' &&
              'border-krypton-alert-rose/40 bg-krypton-alert-rose/10 text-krypton-danger-foreground'
          )}
          data-tone={systemStatus}
        >
          {SYSTEM_STATUS_LABELS[systemStatus]}
        </strong>
      </header>

      <dl className="grid grid-cols-1 items-center gap-krypton-space-4 sm:grid-cols-3 rounded-krypton-radius-control border border-krypton-border-muted bg-krypton-bg-main p-krypton-space-4 sm:p-krypton-space-5">
        <div className="min-w-0 text-left">
          <dt className="text-xs font-medium uppercase tracking-wider text-krypton-fg-muted">
            Active processes
          </dt>
          <dd className="mt-1 break-words font-mono text-2xl font-bold tracking-tight tabular-nums text-krypton-success">
            {activeProcessCount ?? 'Unavailable'}
          </dd>
          <dd className="mt-1 text-xs text-krypton-fg-muted">Supervised MCP children</dd>
        </div>
        <div className="min-w-0 text-center">
          <dt className="flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-wider text-krypton-fg-muted">
            <InfoTooltip
              label="Intercepted alerts"
              tone="neutral"
              content={
                <ul aria-label="Alert counts by severity" className="space-y-krypton-space-1">
                  {(['critical', 'high', 'medium', 'low', 'info'] as const).map((severity) => (
                    <li key={severity}>
                      <span>{severity.charAt(0).toUpperCase() + severity.slice(1)}</span>:{' '}
                      {formatAlertCount(severityCounts[severity]).exact}
                    </li>
                  ))}
                </ul>
              }
            />
            <span>Intercepted alerts</span>
          </dt>
          <dd
            aria-label={`${exactAlertCount} intercepted alerts`}
            className="mt-1 break-words font-mono text-2xl font-bold tabular-nums text-krypton-fg-primary"
            title={exactAlertCount}
          >
            {displayAlertCount}
          </dd>
          <dd className="mt-1 text-xs text-krypton-fg-muted">Total policy rejections</dd>
        </div>
        <div className="flex min-w-0 flex-col items-end text-right">
          <dt className="text-xs font-medium uppercase tracking-wider text-krypton-fg-muted">
            Boundary containment
          </dt>
          <dd
            className={clsx(
              'mt-1 max-w-full break-words font-mono text-base font-semibold sm:text-lg',
              systemStatus === 'operational'
                ? 'text-krypton-accent-cyan'
                : 'text-krypton-fg-secondary'
            )}
          >
            {systemStatus === 'operational'
              ? `Active (v${version})`
              : systemStatus === 'degraded'
                ? 'Degraded'
                : 'Unavailable'}
          </dd>
          <dd className="mt-1 text-xs text-krypton-fg-muted">
            Relative traversal &amp; symlink lock
          </dd>
        </div>
      </dl>
      {controls && (
        <div className="border-t border-krypton-border-muted pt-krypton-space-4">{controls}</div>
      )}
    </section>
  );
}

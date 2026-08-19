import clsx from 'clsx';

export type SystemStatus = 'degraded' | 'offline' | 'operational';

export interface StatusCardProps {
  /** The number of agent child processes currently monitored by Krypton. */
  readonly activeProcessCount: number;

  /** The current global health state of the Krypton watchdog runtime. */
  readonly systemStatus: SystemStatus;
}

const SYSTEM_STATUS_LABELS: Readonly<Record<SystemStatus, string>> = {
  degraded: 'Degraded',
  offline: 'Offline',
  operational: 'Operational',
};

export function StatusCard(props: StatusCardProps): React.JSX.Element {
  const { activeProcessCount, systemStatus } = props;

  return (
    <section
      aria-label="System status"
      className="w-full rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface/80 p-krypton-space-5 shadow-xl shadow-krypton-shadow"
      data-status={systemStatus}
    >
      <header className="flex items-center justify-between gap-krypton-space-4 border-b border-krypton-border-muted pb-krypton-space-4">
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

      <dl className="pt-krypton-space-5">
        <div className="flex items-end justify-between gap-krypton-space-4">
          <dt className="text-sm font-medium text-krypton-fg-muted">Active processes</dt>
          <dd className="font-mono text-3xl font-bold tabular-nums text-krypton-fg-primary">
            {activeProcessCount}
          </dd>
        </div>
      </dl>
    </section>
  );
}

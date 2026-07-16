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

/**
 * Displays the current watchdog health and active monitored-process count.
 *
 * @param {StatusCardProps} props - The system status and active process count to present.
 * @returns {React.JSX.Element} A semantic status summary with token-ready class and data attributes.
 * @example
 * <StatusCard systemStatus="operational" activeProcessCount={4} />
 * // => renders an operational system card with four active processes
 */
export function StatusCard(props: StatusCardProps): React.JSX.Element {
  const { activeProcessCount, systemStatus } = props;

  return (
    <section
      aria-label="System status"
      className="w-full rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface/80 p-krypton-space-5 shadow-xl shadow-black/20"
      data-status={systemStatus}
    >
      <header className="flex items-center justify-between gap-krypton-space-4 border-b border-krypton-border-muted pb-krypton-space-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400">
            Runtime boundary
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-100">Watchdog status</h2>
        </div>
        <strong
          aria-live="polite"
          className={clsx(
            'inline-flex rounded-krypton-radius-full border px-krypton-space-3 py-krypton-space-1 text-xs font-bold uppercase tracking-wider',
            systemStatus === 'operational' &&
              'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
            systemStatus === 'degraded' && 'border-amber-400/40 bg-amber-400/10 text-amber-200',
            systemStatus === 'offline' && 'border-rose-500/40 bg-rose-500/10 text-rose-300'
          )}
          data-tone={systemStatus}
        >
          {SYSTEM_STATUS_LABELS[systemStatus]}
        </strong>
      </header>

      <dl className="pt-krypton-space-5">
        <div className="flex items-end justify-between gap-krypton-space-4">
          <dt className="text-sm font-medium text-slate-400">Active processes</dt>
          <dd className="font-mono text-3xl font-bold tabular-nums text-slate-50">
            {activeProcessCount}
          </dd>
        </div>
      </dl>
    </section>
  );
}

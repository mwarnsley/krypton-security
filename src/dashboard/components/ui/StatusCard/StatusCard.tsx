export type SystemStatus = "degraded" | "offline" | "operational";

export interface StatusCardProps {
  readonly activeProcessCount: number;
  readonly systemStatus: SystemStatus;
}

const SYSTEM_STATUS_LABELS: Readonly<Record<SystemStatus, string>> = {
  degraded: "Degraded",
  offline: "Offline",
  operational: "Operational",
};

/**
 * Displays the current watchdog health and active monitored-process count.
 *
 * @param {StatusCardProps} props - The system status and active process count to present.
 * @returns {React.JSX.Element} A semantic status summary with token-ready class and data attributes.
 * @complexity O(1) time and O(1) space.
 * @example
 * <StatusCard systemStatus="operational" activeProcessCount={4} />
 * // => renders an operational system card with four active processes
 */
export function StatusCard(props: StatusCardProps): React.JSX.Element {
  const { activeProcessCount, systemStatus } = props;

  return (
    <section
      aria-label="System status"
      className="statusCard"
      data-status={systemStatus}
    >
      <header className="statusCard__header">
        <h2 className="statusCard__title">Watchdog status</h2>
        <strong
          aria-live="polite"
          className="statusCard__status"
          data-tone={systemStatus}
        >
          {SYSTEM_STATUS_LABELS[systemStatus]}
        </strong>
      </header>

      <dl className="statusCard__metrics">
        <div className="statusCard__metric">
          <dt className="statusCard__metricLabel">Active processes</dt>
          <dd className="statusCard__metricValue">{activeProcessCount}</dd>
        </div>
      </dl>
    </section>
  );
}

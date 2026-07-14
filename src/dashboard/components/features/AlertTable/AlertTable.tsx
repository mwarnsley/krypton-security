"use client";

import { useMemo } from "react";

export type EnforcementStatus = "INTERCEPTED" | "QUARANTINED";

export interface SecurityAlert {
  readonly attemptedAction: string;
  readonly attemptedPath: string;
  readonly enforcementStatus: EnforcementStatus;
  readonly id: string;
  readonly targetProcessId: number;
  readonly timestamp: string;
  readonly triggerSignature: string;
}

export interface AlertTableProps {
  readonly alerts: readonly SecurityAlert[];
}

/**
 * Renders security telemetry as a semantic, memoized alert data grid.
 *
 * @param {AlertTableProps} props - The immutable security alerts to display in newest-first order.
 * @returns {React.JSX.Element} A token-ready telemetry table or an empty-state row.
 * @complexity O(N) time and O(N) space when the alerts reference changes; O(1) memo retrieval otherwise.
 * @example
 * <AlertTable alerts={[alert]} />
 * // => renders one telemetry row using alert.id as its stable key
 */
export function AlertTable(props: AlertTableProps): React.JSX.Element {
  const { alerts } = props;
  const alertRows = useMemo(
    () =>
      alerts.map((alert) => (
        <tr
          className="alertTable__row"
          data-enforcement-status={alert.enforcementStatus.toLowerCase()}
          key={alert.id}
        >
          <td className="alertTable__cell alertTable__cell--timestamp">
            <time dateTime={alert.timestamp}>{alert.timestamp}</time>
          </td>
          <td className="alertTable__cell alertTable__cell--process">
            {alert.targetProcessId}
          </td>
          <td className="alertTable__cell alertTable__cell--attempt">
            <span className="alertTable__action">{alert.attemptedAction}</span>
            <code className="alertTable__path">{alert.attemptedPath}</code>
          </td>
          <td className="alertTable__cell alertTable__cell--status">
            <strong
              className="alertTable__status"
              data-tone={alert.enforcementStatus.toLowerCase()}
            >
              {alert.enforcementStatus}
            </strong>
          </td>
          <td className="alertTable__cell alertTable__cell--signature">
            <code>{alert.triggerSignature}</code>
          </td>
        </tr>
      )),
    [alerts],
  );

  return (
    <div className="alertTable" data-component="alert-table">
      <table className="alertTable__grid">
        <caption className="alertTable__caption">Security alert telemetry</caption>
        <thead className="alertTable__head">
          <tr>
            <th scope="col">Timestamp</th>
            <th scope="col">Target Process ID</th>
            <th scope="col">Attempted Action / Path Breakout</th>
            <th scope="col">Enforcement Status</th>
            <th scope="col">Trigger Signature</th>
          </tr>
        </thead>
        <tbody className="alertTable__body">
          {alertRows.length > 0 ? (
            alertRows
          ) : (
            <tr className="alertTable__emptyRow">
              <td className="alertTable__emptyCell" colSpan={5}>
                No security alerts detected.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

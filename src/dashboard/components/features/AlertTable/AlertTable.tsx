"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import clsx from "clsx";
import { useCallback, useMemo, useRef, useState } from "react";

export type EnforcementStatus = "INTERCEPTED" | "QUARANTINED";

export interface SecurityAlert {
  /** The denied operation the agent attempted to execute. */
  readonly attemptedAction: string;

  /** The normalized filesystem path associated with the attempted operation. */
  readonly attemptedPath: string;

  /** The final containment state assigned by the Krypton engine. */
  readonly enforcementStatus: EnforcementStatus;

  /** The stable unique identifier used to preserve table-row identity. */
  readonly id: string;

  /** The operating-system process identifier associated with the alert. */
  readonly targetProcessId: number;

  /** The ISO-8601 timestamp recorded when the security event occurred. */
  readonly timestamp: string;

  /** The deterministic policy signature that triggered enforcement. */
  readonly triggerSignature: string;
}

export interface AlertTableProps {
  /** The immutable, newest-first security alerts displayed in the data grid. */
  readonly alerts: readonly SecurityAlert[];
}

/**
 * Dispatches a manual containment request for one target process.
 *
 * @param {number} targetProcessId - The registered workspace PID to isolate.
 * @returns {Promise<void>} A promise that resolves after the API accepts the isolation request.
 * @complexity O(1) client work and O(1) auxiliary space, excluding network latency.
 * @example
 * await requestProcessIsolation(4242);
 * // => undefined after the server confirms isolation
 */
async function requestProcessIsolation(targetProcessId: number): Promise<void> {
  const response = await fetch("/api/telemetry/terminate", {
    body: JSON.stringify({ targetProcessId }),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Isolation request failed with status ${response.status}.`);
  }
}

/**
 * Renders security telemetry through TanStack's memoized row and column model.
 *
 * @param {AlertTableProps} props - The immutable security alerts to display in newest-first order.
 * @returns {React.JSX.Element} A high-contrast telemetry grid with per-process isolation controls.
 * @example
 * <AlertTable alerts={[alert]} />
 * // => renders one telemetry row with a Force Isolate action
 */
export function AlertTable(props: AlertTableProps): React.JSX.Element {
  const { alerts } = props;
  const inFlightProcessIds = useRef(new Set<number>());
  const [isolatingProcessIds, setIsolatingProcessIds] = useState<
    ReadonlySet<number>
  >(new Set());
  const [isolationErrors, setIsolationErrors] = useState<
    ReadonlySet<number>
  >(new Set());

  const forceIsolate = useCallback(async (targetProcessId: number) => {
    if (inFlightProcessIds.current.has(targetProcessId)) {
      return;
    }

    inFlightProcessIds.current.add(targetProcessId);
    setIsolatingProcessIds(new Set(inFlightProcessIds.current));
    setIsolationErrors((currentErrors) => {
      const nextErrors = new Set(currentErrors);
      nextErrors.delete(targetProcessId);
      return nextErrors;
    });

    try {
      await requestProcessIsolation(targetProcessId);
    } catch {
      setIsolationErrors((currentErrors) => {
        const nextErrors = new Set(currentErrors);
        nextErrors.add(targetProcessId);
        return nextErrors;
      });
    } finally {
      inFlightProcessIds.current.delete(targetProcessId);
      setIsolatingProcessIds(new Set(inFlightProcessIds.current));
    }
  }, []);

  const columns = useMemo<ColumnDef<SecurityAlert>[]>(
    () => [
      {
        accessorKey: "timestamp",
        header: "Timestamp",
        cell: ({ getValue }) => {
          const timestamp = getValue<string>();

          return (
            <time
              className="whitespace-nowrap text-slate-300"
              dateTime={timestamp}
            >
              {timestamp}
            </time>
          );
        },
      },
      {
        accessorKey: "targetProcessId",
        header: "Target Process ID",
        cell: ({ getValue }) => (
          <code className="font-mono font-semibold text-cyan-300">
            {getValue<number>()}
          </code>
        ),
      },
      {
        accessorKey: "attemptedAction",
        header: "Attempted Action",
        cell: ({ row }) => (
          <div className="min-w-64 space-y-1">
            <span className="block font-semibold text-slate-100">
              {row.original.attemptedAction}
            </span>
            <code className="block break-all font-mono text-xs text-slate-400">
              {row.original.attemptedPath}
            </code>
          </div>
        ),
      },
      {
        accessorKey: "enforcementStatus",
        header: "Enforcement Status",
        cell: ({ getValue }) => {
          const enforcementStatus = getValue<EnforcementStatus>();

          return (
            <strong
              className={clsx(
                "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-[0.12em]",
                enforcementStatus === "QUARANTINED"
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                  : "border-amber-400/40 bg-amber-400/10 text-amber-200",
              )}
            >
              {enforcementStatus}
            </strong>
          );
        },
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const targetProcessId = row.original.targetProcessId;
          const isIsolating = isolatingProcessIds.has(targetProcessId);
          const hasIsolationError = isolationErrors.has(targetProcessId);

          return (
            <div className="flex min-w-32 flex-col items-start gap-1.5">
              <button
                aria-busy={isIsolating}
                aria-label={`Force isolate process ${targetProcessId}`}
                className="inline-flex min-h-8 items-center justify-center rounded-md border border-rose-400/30 bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm shadow-rose-950/40 transition hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isIsolating}
                onClick={() => void forceIsolate(targetProcessId)}
                type="button"
              >
                {isIsolating ? "Isolating…" : "Force Isolate"}
              </button>
              {hasIsolationError ? (
                <span
                  className="text-[11px] font-medium text-rose-300"
                  role="alert"
                >
                  Isolation failed
                </span>
              ) : null}
            </div>
          );
        },
      },
    ],
    [forceIsolate, isolatingProcessIds, isolationErrors],
  );

  const tableData = useMemo<SecurityAlert[]>(() => [...alerts], [alerts]);
  const table = useReactTable({
    columns,
    data: tableData,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (alert) => alert.id,
  });
  const rows = table.getRowModel().rows;

  return (
    <div
      className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80 shadow-2xl shadow-black/20"
      data-component="alert-table"
    >
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <caption className="sr-only">Security alert telemetry</caption>
          <thead className="border-b border-slate-700 bg-slate-900/95 text-xs uppercase tracking-wider text-slate-400">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    className="px-4 py-3 font-semibold"
                    key={header.id}
                    scope="col"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr
                  className="bg-slate-950/40 transition-colors hover:bg-slate-900/70"
                  data-enforcement-status={row.original.enforcementStatus.toLowerCase()}
                  key={row.id}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td className="px-4 py-3 align-top" key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  className="px-4 py-12 text-center text-sm text-slate-500"
                  colSpan={5}
                >
                  No security alerts detected.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

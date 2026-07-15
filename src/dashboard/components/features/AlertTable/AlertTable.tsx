'use client';

import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Column,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import clsx from 'clsx';
import { format, isValid, parseISO } from 'date-fns';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  MoreVertical,
  SquareTerminal,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  InfoTooltip,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../../ui';
import { downloadExploitSignature } from './exploitSignature';

export type EnforcementStatus = 'AUTOMATED_QUARANTINE' | 'INTERCEPTED' | 'QUARANTINED';

const ALERTS_PER_PAGE = 10;

const ATTEMPTED_ACTION_LABELS: Readonly<Record<string, string>> = {
  filesystem_boundary_breakout: 'Unauthorized Workspace Escape Attempt',
};

const ENFORCEMENT_STATUS_LABELS: Readonly<Record<string, string>> = {
  AUTOMATED_QUARANTINE: 'Auto-Quarantined (Rate Limit)',
  INTERCEPTED: 'Blocked & Isolated',
};

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

export interface IsolationExecutionStatus {
  /** The native execution outcome shown beneath the matching action button. */
  readonly message: string;

  /** The semantic treatment applied to the execution outcome. */
  readonly tone: 'error' | 'success';
}

type IsolationResponseBody = Record<string, unknown>;

interface SortableColumnHeaderProps {
  /** The TanStack column whose sorting state is controlled by the header. */
  readonly column: Column<SecurityAlert, unknown>;

  /** Optional plain-language context exposed beside a security term. */
  readonly helperText?: string;

  /** The visible column label. */
  readonly label: string;
}

/**
 * Converts a machine-oriented ledger key into readable title casing.
 *
 * @param {string} value - The raw underscore-delimited ledger value.
 * @returns {string} A readable fallback label for the operator interface.
 * @complexity O(L) time and space in the source value length.
 * @example
 * humanizeTechnicalKey("READ_FILE");
 * // => "Read File"
 */
function humanizeTechnicalKey(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

/**
 * Translates a raw attempted-action key for operator-facing surfaces.
 *
 * @param {string} attemptedAction - The raw action key recorded in telemetry.
 * @returns {string} The approved plain-language action label.
 * @complexity O(1) average lookup time and O(L) fallback formatting time and space.
 * @example
 * formatAttemptedAction("filesystem_boundary_breakout");
 * // => "Unauthorized Workspace Escape Attempt"
 */
export function formatAttemptedAction(attemptedAction: string): string {
  return ATTEMPTED_ACTION_LABELS[attemptedAction] ?? humanizeTechnicalKey(attemptedAction);
}

/**
 * Translates a raw enforcement state for operator-facing surfaces.
 *
 * @param {EnforcementStatus} enforcementStatus - The raw containment state.
 * @returns {string} The approved plain-language enforcement label.
 * @complexity O(1) average lookup time and O(L) fallback formatting time and space.
 * @example
 * formatEnforcementStatus("INTERCEPTED");
 * // => "Blocked & Isolated"
 */
export function formatEnforcementStatus(enforcementStatus: EnforcementStatus): string {
  return ENFORCEMENT_STATUS_LABELS[enforcementStatus] ?? humanizeTechnicalKey(enforcementStatus);
}

/**
 * Parses an ISO timestamp and formats it in the local device timezone.
 *
 * @param {string} timestamp - The raw ISO-8601 timestamp from telemetry.
 * @returns {string} A readable `YYYY-MM-DD • HH:MM:SS AM/PM` timestamp.
 * @complexity O(L) time and O(1) auxiliary space for fixed-length date fields.
 * @example
 * formatAlertTimestamp("2026-07-14T12:00:00");
 * // => "2026-07-14 • 12:00:00 PM"
 */
export function formatAlertTimestamp(timestamp: string): string {
  const capturedAt = parseISO(timestamp);

  if (!isValid(capturedAt)) {
    return timestamp;
  }

  return format(capturedAt, 'yyyy-MM-dd • hh:mm:ss a');
}

/**
 * Renders structured onboarding guidance for the alert-row action menu.
 *
 * @returns {React.JSX.Element} Two action explanations separated by a subtle divider.
 * @example
 * <ActionsHeaderTooltipContent />
 * // => explains Force Isolate and Download Signature
 */
export function ActionsHeaderTooltipContent(): React.JSX.Element {
  return (
    <div>
      <section>
        <strong className="mb-1 flex items-center gap-2 text-sm font-semibold text-rose-400">
          <SquareTerminal aria-hidden="true" className="h-4 w-4" />
          Force Isolate
        </strong>
        <p className="text-xs font-normal leading-relaxed text-slate-400">
          Immediately drops an OS-level termination signal (SIGKILL) onto the rogue process ID to
          instantly halt execution.
        </p>
      </section>
      <div aria-hidden="true" className="my-3 border-t border-slate-800/60" />
      <section>
        <strong className="mb-1 mt-3 flex items-center gap-2 text-sm font-semibold text-cyan-400">
          <Download aria-hidden="true" className="h-4 w-4" />
          Download Signature
        </strong>
        <p className="text-xs font-normal leading-relaxed text-slate-400">
          Bundles the captured filesystem traversal paths, process identifiers, and mitigation
          metrics into a structured Markdown security report wrapper.
        </p>
      </section>
    </div>
  );
}

/**
 * Renders an accessible sortable table heading with directional feedback.
 *
 * @param {SortableColumnHeaderProps} props - The column, label, and optional helper copy.
 * @returns {React.JSX.Element} A Shadcn button that toggles the column sort direction.
 * @example
 * <SortableColumnHeader column={column} label="Timestamp" />
 * // => renders a sortable Timestamp heading
 */
function SortableColumnHeader(props: SortableColumnHeaderProps): React.JSX.Element {
  const { column, helperText, label } = props;
  const sortDirection = column.getIsSorted();
  const SortIcon =
    sortDirection === 'asc' ? ArrowUp : sortDirection === 'desc' ? ArrowDown : ArrowUpDown;

  return (
    <div className="flex items-center justify-between gap-3 w-full primitive-header-wrapper">
      <Button
        aria-label={`Sort by ${label}${sortDirection ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
        className="-ml-2 h-8 min-w-0 whitespace-nowrap px-2 font-semibold uppercase tracking-wider"
        onClick={() => column.toggleSorting(sortDirection === 'asc')}
        size="sm"
        variant="ghost"
      >
        {label}
        <SortIcon aria-hidden="true" className="h-3.5 w-3.5" />
      </Button>
      {helperText ? <InfoTooltip content={helperText} label={label} /> : null}
    </div>
  );
}

/**
 * Selects compact page controls around the active page.
 *
 * @param {number} activePageIndex - The zero-based active page index.
 * @param {number} pageCount - The total number of available pages.
 * @returns {Array<number | "ellipsis-left" | "ellipsis-right">} Visible page indexes and range markers.
 * @complexity O(1) time and space because at most five page tokens are returned.
 * @example
 * getVisiblePageTokens(4, 10);
 * // => [0, "ellipsis-left", 4, "ellipsis-right", 9]
 */
function getVisiblePageTokens(
  activePageIndex: number,
  pageCount: number
): Array<number | 'ellipsis-left' | 'ellipsis-right'> {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, pageIndex) => pageIndex);
  }

  const tokens: Array<number | 'ellipsis-left' | 'ellipsis-right'> = [0];

  if (activePageIndex > 2) {
    tokens.push('ellipsis-left');
  }

  for (
    let pageIndex = Math.max(1, activePageIndex - 1);
    pageIndex <= Math.min(pageCount - 2, activePageIndex + 1);
    pageIndex += 1
  ) {
    tokens.push(pageIndex);
  }

  if (activePageIndex < pageCount - 3) {
    tokens.push('ellipsis-right');
  }

  tokens.push(pageCount - 1);
  return tokens;
}

/**
 * Determines whether an unknown API payload is an object response body.
 *
 * @param {unknown} value - The parsed API response payload to inspect.
 * @returns {boolean} `true` when the value is a non-array object.
 * @complexity O(1) time and O(1) space.
 * @example
 * isIsolationResponseBody({ success: true, message: "Isolated" });
 * // => true
 */
function isIsolationResponseBody(value: unknown): value is IsolationResponseBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Dispatches a manual containment request for one target process.
 *
 * @param {number} targetProcessId - The registered workspace PID to isolate.
 * @returns {Promise<IsolationExecutionStatus>} The explicit native execution outcome.
 * @complexity O(1) client work and O(1) auxiliary space, excluding network latency.
 * @example
 * await requestProcessIsolation(4242);
 * // => { tone: "success", message: "Target child process successfully verified and isolated." }
 */
export async function requestProcessIsolation(
  targetProcessId: number
): Promise<IsolationExecutionStatus> {
  const response = await fetch('/api/telemetry/terminate', {
    body: JSON.stringify({ targetProcessId }),
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  const responseMessage =
    isIsolationResponseBody(payload) && typeof payload.message === 'string'
      ? payload.message
      : undefined;

  if (!response.ok) {
    return {
      message:
        responseMessage ?? `Isolation request failed with status ${String(response.status)}.`,
      tone: 'error',
    };
  }

  return {
    message: responseMessage ?? 'Target child process successfully verified and isolated.',
    tone: 'success',
  };
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
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: ALERTS_PER_PAGE,
  });
  const [sorting, setSorting] = useState<SortingState>([{ desc: true, id: 'timestamp' }]);
  const [isolatingProcessIds, setIsolatingProcessIds] = useState<ReadonlySet<number>>(new Set());
  const [isolationStatuses, setIsolationStatuses] = useState<
    ReadonlyMap<number, IsolationExecutionStatus>
  >(new Map());

  const forceIsolate = useCallback(async (targetProcessId: number) => {
    if (inFlightProcessIds.current.has(targetProcessId)) {
      return;
    }

    inFlightProcessIds.current.add(targetProcessId);
    setIsolatingProcessIds(new Set(inFlightProcessIds.current));
    setIsolationStatuses((currentStatuses) => {
      const nextStatuses = new Map(currentStatuses);
      nextStatuses.delete(targetProcessId);
      return nextStatuses;
    });

    try {
      const executionStatus = await requestProcessIsolation(targetProcessId);
      setIsolationStatuses((currentStatuses) =>
        new Map(currentStatuses).set(targetProcessId, executionStatus)
      );
    } catch {
      setIsolationStatuses((currentStatuses) =>
        new Map(currentStatuses).set(targetProcessId, {
          message: 'Isolation request could not reach the native vanguard core.',
          tone: 'error',
        })
      );
    } finally {
      inFlightProcessIds.current.delete(targetProcessId);
      setIsolatingProcessIds(new Set(inFlightProcessIds.current));
    }
  }, []);

  const columns = useMemo<ColumnDef<SecurityAlert>[]>(
    () => [
      {
        accessorKey: 'timestamp',
        header: ({ column }) => <SortableColumnHeader column={column} label="Timestamp" />,
        cell: ({ getValue }) => {
          const timestamp = getValue<string>();

          return (
            <time className="whitespace-nowrap text-slate-300" dateTime={timestamp}>
              {formatAlertTimestamp(timestamp)}
            </time>
          );
        },
      },
      {
        accessorKey: 'targetProcessId',
        header: ({ column }) => (
          <SortableColumnHeader
            column={column}
            helperText="PID means Process ID: the operating-system number assigned to the agent process involved in this event."
            label="Target Process ID"
          />
        ),
        cell: ({ getValue }) => (
          <code className="font-mono font-semibold text-cyan-300">{getValue<number>()}</code>
        ),
      },
      {
        accessorKey: 'attemptedAction',
        header: ({ column }) => (
          <SortableColumnHeader
            column={column}
            helperText="A workspace boundary escape is an attempt to access files outside the agent's approved working folder."
            label="Attempted Action"
          />
        ),
        cell: ({ row }) => (
          <div className="min-w-64 space-y-1">
            <span className="block font-semibold text-slate-100">
              {formatAttemptedAction(row.original.attemptedAction)}
            </span>
            <code className="block break-all font-mono text-xs text-slate-400">
              {row.original.attemptedPath}
            </code>
          </div>
        ),
      },
      {
        accessorKey: 'enforcementStatus',
        header: ({ column }) => (
          <SortableColumnHeader
            column={column}
            helperText="Enforcement Status shows whether Krypton intercepted the action or quarantined the associated process."
            label="Enforcement Status"
          />
        ),
        cell: ({ getValue }) => {
          const enforcementStatus = getValue<EnforcementStatus>();

          return (
            <strong
              className={clsx(
                'inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-[0.12em]',
                enforcementStatus === 'QUARANTINED' || enforcementStatus === 'AUTOMATED_QUARANTINE'
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : 'border-amber-400/40 bg-amber-400/10 text-amber-200'
              )}
            >
              {formatEnforcementStatus(enforcementStatus)}
            </strong>
          );
        },
      },
      {
        id: 'actions',
        header: () => (
          <div className="flex items-center justify-between gap-3 w-full primitive-header-wrapper">
            <span className="whitespace-nowrap">Actions</span>
            <InfoTooltip
              content={<ActionsHeaderTooltipContent />}
              contentClassName="max-w-[320px] rounded-xl border border-slate-800 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-md sm:p-5"
              label="Actions"
            />
          </div>
        ),
        cell: ({ row }) => {
          const targetProcessId = row.original.targetProcessId;
          const isIsolating = isolatingProcessIds.has(targetProcessId);
          const isolationStatus = isolationStatuses.get(targetProcessId);

          return (
            <div className="flex min-w-10 flex-col items-start gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-busy={isIsolating}
                    aria-label={`Open actions for process ${targetProcessId}`}
                    disabled={isIsolating}
                    size="icon"
                    variant="ghost"
                  >
                    <MoreVertical aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-200"
                    disabled={isIsolating}
                    onSelect={() => void forceIsolate(targetProcessId)}
                  >
                    <SquareTerminal aria-hidden="true" className="h-4 w-4" />
                    {isIsolating ? 'Isolating…' : 'Force Isolate'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-slate-200 focus:text-white"
                    onSelect={() =>
                      downloadExploitSignature({
                        mitigationStatus: formatEnforcementStatus(row.original.enforcementStatus),
                        securityEvent: formatAttemptedAction(row.original.attemptedAction),
                        targetProcessId,
                        timestamp: row.original.timestamp,
                        violatedContainmentPath: row.original.attemptedPath,
                      })
                    }
                  >
                    <Download aria-hidden="true" className="h-4 w-4" />
                    Download Signature
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {isolationStatus ? (
                <span
                  aria-live="polite"
                  className={clsx(
                    'max-w-56 text-[11px] font-medium',
                    isolationStatus.tone === 'success' ? 'text-emerald-300' : 'text-rose-300'
                  )}
                  role={isolationStatus.tone === 'success' ? 'status' : 'alert'}
                >
                  {isolationStatus.message}
                </span>
              ) : null}
            </div>
          );
        },
      },
    ],
    [forceIsolate, isolatingProcessIds, isolationStatuses]
  );

  const tableData = useMemo<SecurityAlert[]>(() => [...alerts], [alerts]);
  const table = useReactTable({
    columns,
    data: tableData,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (alert) => alert.id,
    getSortedRowModel: getSortedRowModel(),
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    state: { pagination, sorting },
  });
  const rows = table.getRowModel().rows;
  const pageCount = Math.max(1, table.getPageCount());
  const visiblePageTokens = getVisiblePageTokens(table.getState().pagination.pageIndex, pageCount);

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
                  <th className="px-4 py-3 font-semibold" key={header.id} scope="col">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
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
                <td className="px-4 py-12 text-center text-sm text-slate-500" colSpan={5}>
                  No security alerts detected.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <footer className="flex flex-col gap-3 border-t border-slate-800 bg-slate-900/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-400" role="status">
          Page {table.getState().pagination.pageIndex + 1} of {pageCount} ·{' '}
          {table.getPrePaginationRowModel().rows.length} alerts
        </p>
        <Pagination className="w-auto">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              />
            </PaginationItem>
            {visiblePageTokens.map((pageToken) =>
              typeof pageToken === 'number' ? (
                <PaginationItem key={pageToken}>
                  <PaginationLink
                    aria-label={`Go to page ${pageToken + 1}`}
                    isActive={pageToken === table.getState().pagination.pageIndex}
                    onClick={() => table.setPageIndex(pageToken)}
                  >
                    {pageToken + 1}
                  </PaginationLink>
                </PaginationItem>
              ) : (
                <PaginationItem key={pageToken}>
                  <PaginationEllipsis />
                </PaginationItem>
              )
            )}
            <PaginationItem>
              <PaginationNext disabled={!table.getCanNextPage()} onClick={() => table.nextPage()} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </footer>
    </div>
  );
}

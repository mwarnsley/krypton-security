'use client';

import {
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

import type {
  EnforcementStatus,
  ProcessIdentityPayload,
  SecurityAlert,
  TelemetrySeverity,
} from '../../../types';
import { downloadExploitSignature } from '../../../utils/exploitSignature';
import { KryptonButton, KryptonIconButton } from '../../primitives';
import { KryptonDataTable } from '../KryptonDataTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui';
import { InfoTooltip } from '../InfoTooltip';

export type { EnforcementStatus, SecurityAlert, TelemetrySeverity } from '../../../types';

const DEFAULT_ALERTS_PER_PAGE = 25;
const ALERT_PAGE_SIZE_OPTIONS = [10, 25, 50, 75, 100] as const;

const ATTEMPTED_ACTION_LABELS: Readonly<Record<string, string>> = {
  filesystem_boundary_breakout: 'Unauthorized Workspace Escape Attempt',
};

const ENFORCEMENT_STATUS_LABELS: Readonly<Record<string, string>> = {
  AUTOMATED_QUARANTINE: 'Auto-Quarantined (Rate Limit)',
  INTERCEPTED: 'Blocked & Isolated',
  OBSERVED: 'Observed',
};

const SEVERITY_CLASSES: Readonly<Record<TelemetrySeverity, string>> = {
  critical: 'border-krypton-alert-rose bg-krypton-alert-rose/10 text-krypton-alert-rose',
  high: 'border-krypton-warning-amber bg-krypton-warning-amber/10 text-krypton-warning-amber',
  info: 'border-krypton-accent-cyan/40 bg-krypton-accent-cyan/10 text-krypton-accent-cyan',
  low: 'border-krypton-border-muted bg-krypton-bg-surface text-krypton-fg-secondary',
  medium:
    'border-krypton-warning-amber/50 bg-krypton-warning-amber/10 text-krypton-warning-foreground',
};

export interface AlertTableProps {
  /** The immutable, newest-first security alerts displayed in the data grid. */
  readonly alerts: SecurityAlert[];
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
 * Resolves a row-count selector value into a safe TanStack page size.
 *
 * @param {string} selection - A supported numeric option or the `ALL` sentinel.
 * @returns {number} A positive page size, defaulting to 25 for invalid input.
 * @complexity O(P) time for the fixed option count P and O(1) space.
 * @example
 * resolveAlertPageSize('ALL', 4970);
 * // => 4970
 */
export function resolveAlertPageSize(selection: string): number {
  const numericSelection = Number(selection);

  return ALERT_PAGE_SIZE_OPTIONS.some((pageSize) => pageSize === numericSelection)
    ? numericSelection
    : DEFAULT_ALERTS_PER_PAGE;
}

export function ActionsHeaderTooltipContent(): React.JSX.Element {
  return (
    <div>
      <section>
        <strong className="mb-1 flex items-center gap-2 text-sm font-semibold text-krypton-alert-rose">
          <SquareTerminal aria-hidden="true" className="h-4 w-4" />
          Force Isolate
        </strong>
        <p className="text-xs font-normal leading-relaxed text-krypton-fg-muted">
          Immediately drops an OS-level termination signal (SIGKILL) onto the rogue process ID to
          instantly halt execution.
        </p>
      </section>
      <div aria-hidden="true" className="my-3 border-t border-krypton-border-muted/60" />
      <section>
        <strong className="mb-1 mt-3 flex items-center gap-2 text-sm font-semibold text-krypton-accent-cyan">
          <Download aria-hidden="true" className="h-4 w-4" />
          Download Signature
        </strong>
        <p className="text-xs font-normal leading-relaxed text-krypton-fg-muted">
          Bundles the captured filesystem traversal paths, process identifiers, and mitigation
          metrics into a structured Markdown security report wrapper.
        </p>
      </section>
    </div>
  );
}

function SortableColumnHeader(props: SortableColumnHeaderProps): React.JSX.Element {
  const { column, helperText, label } = props;
  const sortDirection = column.getIsSorted();
  const SortIcon =
    sortDirection === 'asc' ? ArrowUp : sortDirection === 'desc' ? ArrowDown : ArrowUpDown;

  return (
    <div className="flex w-full items-center justify-between gap-krypton-space-3 primitive-header-wrapper">
      <KryptonButton
        aria-label={`Sort by ${label}${sortDirection ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
        endIcon={<SortIcon aria-hidden="true" className="h-3.5 w-3.5" />}
        onClick={() => column.toggleSorting(sortDirection === 'asc')}
        size="sm"
        variant="link"
      >
        {label}
      </KryptonButton>
      {helperText ? <InfoTooltip content={helperText} label={label} /> : null}
    </div>
  );
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
 * @param {ProcessIdentityPayload} processIdentity - The exact registered process generation.
 * @returns {Promise<IsolationExecutionStatus>} The explicit native execution outcome.
 * @complexity O(1) client work and O(1) auxiliary space, excluding network latency.
 * @example
 * await requestProcessIsolation({ pid: 4242, startTime: 1, executablePath: '/bin/node', parentPid: 1 });
 * // => { tone: "success", message: "Target child process successfully verified and isolated." }
 */
export async function requestProcessIsolation(
  processIdentity: ProcessIdentityPayload
): Promise<IsolationExecutionStatus> {
  const response = await fetch('/api/telemetry/terminate', {
    body: JSON.stringify({ process: processIdentity }),
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

export function AlertTable(props: AlertTableProps): React.JSX.Element {
  const { alerts } = props;
  const inFlightProcessIds = useRef(new Set<number>());
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_ALERTS_PER_PAGE,
  });
  const [pageSizeSelection, setPageSizeSelection] = useState('25');
  const [sorting, setSorting] = useState<SortingState>([{ desc: true, id: 'timestamp' }]);
  const [isolatingProcessIds, setIsolatingProcessIds] = useState<ReadonlySet<number>>(new Set());
  const [isolationStatuses, setIsolationStatuses] = useState<
    ReadonlyMap<number, IsolationExecutionStatus>
  >(new Map());

  const forceIsolate = useCallback(async (processIdentity: ProcessIdentityPayload) => {
    const targetProcessId = processIdentity.pid;
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
      const executionStatus = await requestProcessIsolation(processIdentity);
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
            <time className="whitespace-nowrap text-krypton-fg-secondary" dateTime={timestamp}>
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
            label="Process ID"
          />
        ),
        cell: ({ getValue }) => (
          <code className="font-mono font-semibold tracking-krypton-mono text-krypton-accent-cyan">
            {getValue<number>()}
          </code>
        ),
      },
      {
        accessorKey: 'processName',
        header: ({ column }) => (
          <SortableColumnHeader
            column={column}
            helperText="Application / Tool identifies the automated application or developer tool associated with the security event."
            label="Application / Tool"
          />
        ),
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap font-semibold text-krypton-fg-primary">
            {getValue<string>()}
          </span>
        ),
      },
      {
        accessorKey: 'attemptedPath',
        header: ({ column }) => (
          <SortableColumnHeader
            column={column}
            helperText="Attempted Access Location is the file system or network location involved in the security event."
            label="Attempted Access Location"
          />
        ),
        cell: ({ getValue }) => (
          <code className="block min-w-64 break-all font-mono text-xs text-krypton-fg-muted">
            {getValue<string>()}
          </code>
        ),
      },
      {
        accessorKey: 'severity',
        header: ({ column }) => (
          <SortableColumnHeader
            column={column}
            helperText="Severity is the normalized risk tier assigned to the observed or blocked behavior."
            label="Severity"
          />
        ),
        cell: ({ getValue }) => {
          const severity = getValue<TelemetrySeverity>();

          return (
            <strong
              className={clsx(
                'inline-flex rounded-krypton-radius-full border px-2.5 py-krypton-space-1 text-krypton-micro font-bold uppercase tracking-krypton-label',
                SEVERITY_CLASSES[severity]
              )}
            >
              {severity}
            </strong>
          );
        },
      },
      {
        accessorKey: 'origin_attribution',
        header: ({ column }) => (
          <SortableColumnHeader
            column={column}
            helperText="Verified Signature identifies the package, task, or local script associated with the application."
            label="Verified Signature"
          />
        ),
        cell: ({ getValue }) => (
          <span className="inline-flex max-w-56 rounded-krypton-radius-control border border-krypton-border-muted bg-krypton-bg-surface px-krypton-space-2 py-krypton-space-1 font-mono text-krypton-nano font-semibold tracking-krypton-mono text-krypton-fg-secondary">
            {getValue<string>()}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => (
          <div className="flex w-full items-center justify-between gap-krypton-space-3 primitive-header-wrapper">
            <span className="whitespace-nowrap">Actions</span>
            <InfoTooltip content={<ActionsHeaderTooltipContent />} label="Actions" size="lg" />
          </div>
        ),
        cell: ({ row }) => {
          const targetProcessId = row.original.targetProcessId;
          const processIdentity = row.original.process;
          const isActionable = targetProcessId !== null && processIdentity !== undefined;
          const isIsolating =
            targetProcessId === null ? false : isolatingProcessIds.has(targetProcessId);
          const isolationStatus =
            targetProcessId === null ? undefined : isolationStatuses.get(targetProcessId);

          return (
            <div className="flex min-w-10 flex-col items-start gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <KryptonIconButton
                    aria-busy={isIsolating}
                    aria-label={
                      isActionable
                        ? `Open actions for process ${String(targetProcessId)}`
                        : 'Process isolation unavailable for unattributed event'
                    }
                    disabled={!isActionable || isIsolating}
                    icon={<MoreVertical />}
                    size="md"
                    variant="link"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-krypton-danger-foreground focus:bg-krypton-alert-rose/10 focus:text-krypton-danger-foreground"
                    disabled={!isActionable || isIsolating}
                    onSelect={() => {
                      if (processIdentity !== undefined) void forceIsolate(processIdentity);
                    }}
                  >
                    <SquareTerminal aria-hidden="true" className="h-4 w-4" />
                    {isIsolating ? 'Isolating…' : 'Force Isolate'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-krypton-fg-secondary focus:text-krypton-fg-primary"
                    onSelect={() =>
                      downloadExploitSignature({
                        mitigationStatus: formatEnforcementStatus(row.original.enforcementStatus),
                        securityEvent: formatAttemptedAction(row.original.attemptedAction),
                        targetProcessId: targetProcessId ?? 0,
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
                    'max-w-56 text-krypton-micro font-medium',
                    isolationStatus.tone === 'success'
                      ? 'text-krypton-success'
                      : 'text-krypton-danger-foreground'
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

  return (
    <KryptonDataTable
      caption="Security alert telemetry"
      columns={columns}
      data={alerts}
      emptyMessage="No security alerts detected."
      getRowDataAttributes={(alert) => ({
        'data-enforcement-status': alert.enforcementStatus.toLowerCase(),
      })}
      getRowId={(alert) => alert.id}
      itemLabel="alert"
      pagination={{
        onChange: setPagination,
        onPageSizeSelectionChange: setPageSizeSelection,
        pageSizeOptions: ALERT_PAGE_SIZE_OPTIONS,
        pageSizeSelection,
        state: pagination,
      }}
      sorting={{ onChange: setSorting, state: sorting }}
    />
  );
}

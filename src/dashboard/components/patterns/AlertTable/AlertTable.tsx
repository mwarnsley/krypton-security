'use client';

import {
  flexRender,
  type Row,
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
  ClipboardCopy,
  Code,
  Download,
  Folder,
  MoreVertical,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import type {
  EnforcementStatus,
  ProcessIdentityPayload,
  SecurityAlert,
  TelemetrySeverity,
} from '../../../types';
import { ALERT_SEVERITY_CLASSES } from '../../../utils';
import {
  copyProcessDetails,
  downloadThreatReport,
  normalizeProtectedWorkspaceRoot,
} from '../../../utils';
import { AlertInspector, type AlertInspection } from '../AlertInspector';
import { KryptonButton, KryptonIconButton } from '../../primitives';
import { KryptonDataTable } from '../KryptonDataTable';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../ui';
import { InfoTooltip } from '../InfoTooltip';

export type { EnforcementStatus, SecurityAlert, TelemetrySeverity } from '../../../types';

const DEFAULT_ALERTS_PER_PAGE = 25;
const ALERT_PAGE_SIZE_OPTIONS = [10, 25, 50, 75, 100] as const;

export const SIMULATED_ALERT_ACTION_LABELS = [
  'View Raw Event (JSON)',
  'Copy Process Details',
  'View Allowed Folder',
  'Download Threat Report',
] as const;

const ATTEMPTED_ACTION_LABELS: Readonly<Record<string, string>> = {
  filesystem_boundary_breakout: 'Unauthorized Workspace Escape Attempt',
};

const ENFORCEMENT_STATUS_LABELS: Readonly<Record<string, string>> = {
  AUTOMATED_QUARANTINE: 'Auto-Quarantined (Rate Limit)',
  INTERCEPTED: 'Intercepted (unconfirmed)',
  QUARANTINED: 'Quarantine reported (unconfirmed)',
  ISOLATED: 'Isolated',
  TERMINATED: 'Terminated',
  OBSERVED: 'Observed',
};

export interface AlertTableProps {
  /** The immutable, newest-first security alerts displayed in the data grid. */
  readonly alerts: SecurityAlert[];
  /** Current folder reported by the connected native runtime, not the attempted path. */
  readonly protectedWorkspaceRoot?: string;
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
 * // => "Intercepted (unconfirmed)"
 */
export function formatEnforcementStatus(enforcementStatus: EnforcementStatus): string {
  return ENFORCEMENT_STATUS_LABELS[enforcementStatus] ?? humanizeTechnicalKey(enforcementStatus);
}

/**
 * Parses an ISO timestamp and formats it in the local device timezone.
 *
 * @param {string} timestamp - The raw ISO-8601 timestamp from telemetry.
 * @returns {string} A readable `MM/DD/YYYY • HH:MM:SS AM/PM` timestamp.
 * @complexity O(L) time and O(1) auxiliary space for fixed-length date fields.
 * @example
 * formatAlertTimestamp("2026-07-14T12:00:00");
 * // => "07/14/2026 • 12:00:00 PM"
 */
export function formatAlertTimestamp(timestamp: string): string {
  const capturedAt = parseISO(timestamp);

  if (!isValid(capturedAt)) {
    return timestamp;
  }

  return format(capturedAt, 'MM/dd/yyyy • hh:mm:ss a');
}

/**
 * Selects native enforcement actions only for sequenced evidence with a complete process identity.
 *
 * @param {SecurityAlert} alert - The telemetry row whose action boundary is being selected.
 * @returns {'native' | 'simulation'} Native actions for verified process evidence, otherwise mock actions.
 * @complexity O(1) time and O(1) auxiliary space.
 * @example
 * resolveAlertActionMode(simulatedAlert);
 * // => "simulation"
 */
export function resolveAlertActionMode(alert: SecurityAlert): 'native' | 'simulation' {
  return alert.attribution === 'process' &&
    alert.sequence !== undefined &&
    alert.process !== undefined &&
    alert.targetProcessId !== null &&
    alert.process.pid === alert.targetProcessId
    ? 'native'
    : 'simulation';
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
    <div className="space-y-2.5">
      <section>
        <h3 className="flex items-center gap-krypton-space-2 text-xs font-medium text-krypton-accent-cyan">
          <Code aria-hidden="true" className="h-4 w-4 shrink-0" />
          View Raw Event
        </h3>
        <p className="mt-1 text-krypton-micro leading-normal text-krypton-fg-body">
          Inspect the raw intercepted security payload and metadata.
        </p>
      </section>
      <hr className="border-t border-krypton-border-muted/80" />
      <section>
        <h3 className="flex items-center gap-krypton-space-2 text-xs font-medium text-krypton-fg-primary">
          <ClipboardCopy aria-hidden="true" className="h-4 w-4 shrink-0" />
          Copy Process Details
        </h3>
        <p className="mt-1 text-krypton-micro leading-normal text-krypton-fg-body">
          Copy process ID, binary name, and execution parameters.
        </p>
      </section>
      <hr className="border-t border-krypton-border-muted/80" />
      <section>
        <h3 className="flex items-center gap-krypton-space-2 text-xs font-medium text-krypton-fg-primary">
          <Folder aria-hidden="true" className="h-4 w-4 shrink-0" />
          View Allowed Folder
        </h3>
        <p className="mt-1 text-krypton-micro leading-normal text-krypton-fg-body">
          Check the exact boundary directory path permitted for this session.
        </p>
      </section>
      <hr className="border-t border-krypton-border-muted/80" />
      <section>
        <h3 className="flex items-center gap-krypton-space-2 text-xs font-medium text-krypton-accent-cyan">
          <Download aria-hidden="true" className="h-4 w-4 shrink-0" />
          Download Threat Report
        </h3>
        <p className="mt-1 text-krypton-micro leading-normal text-krypton-fg-body">
          Export a Markdown report summarizing the policy rejection and path details.
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
    <div className="flex items-center gap-1.5 primitive-header-wrapper">
      {helperText ? <InfoTooltip content={helperText} label={label} /> : null}
      <KryptonButton
        aria-label={`Sort by ${label}${sortDirection ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
        endIcon={<SortIcon aria-hidden="true" className="h-3.5 w-3.5" />}
        onClick={() => column.toggleSorting(sortDirection === 'asc')}
        size="compact"
        variant="link"
      >
        {label}
      </KryptonButton>
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

/**
 * Keys action receipts to a complete generation so PID reuse cannot inherit success.
 * @param {ProcessIdentityPayload} process - Revalidated native identity submitted to the API.
 * @returns {string} Collision-free serialization of the four identity fields.
 * @complexity O(L) time and space in executable path length.
 * @example
 * isolationIdentityKey({ pid: 42, startTime: 10, executablePath: '/bin/node', parentPid: 1 });
 * // => '[42,10,"/bin/node",1]'
 */
export function isolationIdentityKey(process: ProcessIdentityPayload): string {
  return JSON.stringify([
    process.pid,
    process.startTime,
    process.executablePath,
    process.parentPid,
  ]);
}

/**
 * Renders a compact alert from the same cells that own desktop attribution and actions.
 * @param {Row<SecurityAlert>} row - One already sorted and paginated alert row.
 * @returns {ReactNode} A card body with a native keyboard-accessible signature disclosure.
 * @complexity O(C + L) time and space for fixed columns C and displayed text length L.
 */
function renderMobileAlert(row: Row<SecurityAlert>): ReactNode {
  const cells = new Map(row.getVisibleCells().map((cell) => [cell.column.id, cell]));
  const renderCell = (id: string): ReactNode => {
    const cell = cells.get(id);
    return cell === undefined ? null : flexRender(cell.column.columnDef.cell, cell.getContext());
  };
  return (
    <article className="min-w-0 space-y-krypton-space-4">
      <div className="flex flex-wrap items-center justify-between gap-krypton-space-2 text-xs">
        {renderCell('timestamp')}
        {renderCell('severity')}
      </div>
      <div className="space-y-krypton-space-2">
        <h3 className="break-all text-sm font-semibold text-krypton-fg-primary">
          {row.original.processName}
        </h3>
        <p className="text-xs text-krypton-fg-muted">Target Path</p>
        <code className="block break-all font-mono text-xs text-krypton-fg-secondary">
          {row.original.attemptedPath}
        </code>
      </div>
      <div className="flex items-start justify-between gap-krypton-space-3 border-t border-krypton-border-muted pt-krypton-space-3">
        <div className="min-w-0 break-words text-xs">
          <p className="mb-krypton-space-1 text-krypton-fg-muted">Process ID attribution</p>
          {renderCell('targetProcessId')}
        </div>
        {renderCell('actions')}
      </div>
      <details className="group min-w-0 rounded-krypton-radius-control border border-krypton-border-muted">
        <summary className="min-h-11 cursor-pointer rounded-krypton-radius-control p-krypton-space-3 text-xs text-krypton-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krypton-focus-ring">
          <span className="font-semibold">Security Verification</span>
          <span
            aria-hidden="true"
            className="mt-krypton-space-1 block truncate font-mono text-krypton-fg-muted group-open:hidden"
          >
            {row.original.origin_attribution}
          </span>
        </summary>
        <code className="block break-all px-krypton-space-3 pb-krypton-space-3 font-mono text-xs text-krypton-fg-secondary">
          {row.original.origin_attribution}
        </code>
      </details>
    </article>
  );
}

export function AlertTable(props: AlertTableProps): React.JSX.Element {
  const { alerts } = props;
  const protectedWorkspaceRoot = normalizeProtectedWorkspaceRoot(props.protectedWorkspaceRoot);
  const tableContainer = useRef<HTMLDivElement>(null);
  const lastActionTrigger = useRef<HTMLButtonElement | null>(null);
  const inspectorOpening = useRef(false);
  const [selection, setSelection] = useState<AlertInspection | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_ALERTS_PER_PAGE,
  });
  const [pageSizeSelection, setPageSizeSelection] = useState('25');
  const [sorting, setSorting] = useState<SortingState>([{ desc: true, id: 'timestamp' }]);
  const openInspector = useCallback((alert: SecurityAlert, view: AlertInspection['view']) => {
    inspectorOpening.current = true;
    setSelection({ alert, view });
  }, []);
  const copyDetails = useCallback(async (alert: SecurityAlert) => {
    const result = await copyProcessDetails(alert);
    setFeedback(
      result.ok
        ? { message: 'Process details copied.', error: false }
        : {
            message:
              'Copy unavailable. Open View Raw Event (JSON) to select the recorded details manually.',
            error: true,
          }
    );
  }, []);
  const exportReport = useCallback(
    (alert: SecurityAlert) => {
      const result = downloadThreatReport(alert, protectedWorkspaceRoot);
      setFeedback(
        result.ok
          ? { message: 'Unsigned Markdown threat report download requested.', error: false }
          : {
              message:
                'Report download unavailable. Open View Raw Event (JSON) to retain the recorded details.',
              error: true,
            }
      );
    },
    [protectedWorkspaceRoot]
  );
  const returnInspectorFocus = useCallback(() => {
    inspectorOpening.current = false;
    if (
      lastActionTrigger.current?.isConnected &&
      lastActionTrigger.current.getClientRects().length > 0
    )
      lastActionTrigger.current.focus();
    else tableContainer.current?.focus();
  }, []);

  const columns = useMemo<ColumnDef<SecurityAlert>[]>(
    () => [
      {
        accessorKey: 'timestamp',
        header: ({ column }) => (
          <SortableColumnHeader
            column={column}
            helperText="Time the security event was recorded, shown in your local timezone."
            label="Timestamp"
          />
        ),
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
            helperText="The system ID and containment status, when the application is known. Unattributed events show whether activity was blocked or observed."
            label="Process ID"
          />
        ),
        cell: ({ getValue, row }) => (
          <code className="font-mono font-semibold tracking-krypton-mono text-krypton-accent-cyan">
            {row.original.attribution === 'unattributed'
              ? row.original.triggerSignature === 'NATIVE_MCP_BOUNDARY' &&
                row.original.enforcementStatus === 'INTERCEPTED'
                ? 'Blocked (Unattributed)'
                : 'Observed (unattributed)'
              : getValue<number | null>()}
            {row.original.attribution === 'process' && row.original.enforcementStatus === 'OBSERVED'
              ? ' — OBSERVED'
              : ''}
          </code>
        ),
      },
      {
        accessorKey: 'processName',
        header: ({ column }) => (
          <SortableColumnHeader
            column={column}
            helperText="The tool or command recorded for this event, when known."
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
            helperText="The file or directory path involved in the recorded activity."
            label="Target Path"
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
            helperText="Severity is the normalized risk level assigned to the observed or blocked behavior."
            label="Severity"
          />
        ),
        cell: ({ getValue }) => {
          const severity = getValue<TelemetrySeverity>();

          return (
            <strong
              className={clsx(
                'inline-flex rounded-krypton-radius-full border px-krypton-space-3 py-0.5 text-xs font-semibold uppercase tracking-wider',
                ALERT_SEVERITY_CLASSES[severity]
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
            helperText="Shows the event source and the security evidence recorded by Krypton. Demo events are simulated."
            label="Security Verification"
          />
        ),
        cell: ({ getValue }) => (
          <span className="block min-w-krypton-signature max-w-krypton-signature whitespace-normal break-words rounded-krypton-radius-control border border-krypton-border-muted bg-krypton-bg-surface px-krypton-space-2 py-krypton-space-1 font-mono text-xs font-semibold tracking-krypton-mono text-krypton-fg-secondary">
            {getValue<string>()}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => (
          <div className="flex w-full items-center justify-end gap-1.5 text-right primitive-header-wrapper">
            <InfoTooltip
              appearance="unboxed"
              content={<ActionsHeaderTooltipContent />}
              label="Actions"
              size="legend"
              tone="legend"
            />
            <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-krypton-fg-muted">
              Actions
            </span>
          </div>
        ),
        cell: ({ row }) => (
          <div className="flex min-w-10 justify-end text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <KryptonIconButton
                  aria-label={`Open event actions for ${row.original.processName}`}
                  onFocus={(event) => {
                    lastActionTrigger.current = event.currentTarget;
                  }}
                  onPointerDown={(event) => {
                    lastActionTrigger.current = event.currentTarget;
                  }}
                  icon={<MoreVertical />}
                  size="lg"
                  variant="secondary"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => {
                  if (inspectorOpening.current) event.preventDefault();
                }}
              >
                <DropdownMenuItem
                  className="!gap-2.5 !px-3 !py-2 !text-xs"
                  onSelect={() => openInspector(row.original, 'raw')}
                >
                  <Code aria-hidden="true" className="h-4 w-4 shrink-0 text-krypton-accent-cyan" />
                  View Raw Event (JSON)
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="!gap-2.5 !px-3 !py-2 !text-xs"
                  onSelect={() => {
                    void copyDetails(row.original);
                  }}
                >
                  <ClipboardCopy
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-krypton-fg-body"
                  />
                  Copy Process Details
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="!gap-2.5 !px-3 !py-2 !text-xs"
                  onSelect={() => openInspector(row.original, 'folder')}
                >
                  <Folder aria-hidden="true" className="h-4 w-4 shrink-0 text-krypton-fg-body" />
                  View Allowed Folder
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="!gap-2.5 !px-3 !py-2 !text-xs"
                  onSelect={() => exportReport(row.original)}
                >
                  <Download
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-krypton-accent-cyan"
                  />
                  Download Threat Report
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [openInspector, copyDetails, exportReport]
  );

  return (
    <div
      ref={tableContainer}
      tabIndex={-1}
      role="group"
      aria-label="Security activity table"
      className="w-full min-w-0"
    >
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
        renderMobileRow={renderMobileAlert}
      />
      {feedback && (
        <p
          role={feedback.error ? 'alert' : 'status'}
          aria-label="Event action feedback"
          className={clsx(
            'mt-krypton-space-3 text-sm',
            feedback.error ? 'text-krypton-danger-foreground' : 'text-krypton-fg-secondary'
          )}
        >
          {feedback.message}
        </p>
      )}
      <AlertInspector
        selection={selection}
        {...(protectedWorkspaceRoot === undefined ? {} : { protectedWorkspaceRoot })}
        onClose={() => setSelection(null)}
        onReturnFocus={returnInspectorFocus}
      />
    </div>
  );
}

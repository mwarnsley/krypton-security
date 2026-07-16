'use client';

import clsx from 'clsx';
import { ArrowUp } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  AlertTable,
  formatAttemptedAction,
  formatEnforcementStatus,
  type EnforcementStatus,
  type SecurityAlert,
  InfoTooltip,
  StatusCard,
  type SystemStatus,
} from '../components/patterns';
import { KryptonButton, KryptonIconButton, KryptonToggle } from '../components/primitives';

const TELEMETRY_POLL_INTERVAL_MS = 5_000;
const BREAKOUT_TOAST_FRESHNESS_WINDOW_MS = 10_000;
const BACK_TO_TOP_VISIBILITY_THRESHOLD_PX = 300;

interface TelemetryState {
  /** The number of owned child processes currently monitored by Krypton. */
  readonly activeProcessCount: number;

  /** The newest-first security events returned by the telemetry endpoint. */
  readonly alerts: readonly SecurityAlert[];
}

type TelemetryRecord = Record<string, unknown>;

const EMPTY_TELEMETRY: TelemetryState = {
  activeProcessCount: 0,
  alerts: [],
};

/**
 * Determines whether an unknown telemetry payload is a non-array record.
 *
 * @param {unknown} value - The telemetry value to inspect.
 * @returns {boolean} `true` when the value can be read as a telemetry record.
 * @complexity O(1) time and O(1) space.
 * @example
 * isTelemetryRecord({ alerts: [] });
 * // => true
 */
function isTelemetryRecord(value: unknown): value is TelemetryRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a string field from a telemetry record with optional legacy-key support.
 *
 * @param {TelemetryRecord} record - The normalized object containing telemetry fields.
 * @param {string} primaryKey - The preferred current schema key.
 * @param {string | undefined} fallbackKey - The optional legacy schema key.
 * @returns {string | undefined} The first valid string value or `undefined`.
 * @complexity O(1) time and O(1) space for direct object-key access.
 * @example
 * readString({ action: 'blocked' }, 'attemptedAction', 'action');
 * // => 'blocked'
 */
function readString(
  record: TelemetryRecord,
  primaryKey: string,
  fallbackKey?: string
): string | undefined {
  const primaryValue = record[primaryKey];

  if (typeof primaryValue === 'string') {
    return primaryValue;
  }

  const fallbackValue = fallbackKey === undefined ? undefined : record[fallbackKey];

  return typeof fallbackValue === 'string' ? fallbackValue : undefined;
}

/**
 * Maps current and legacy telemetry records to a supported enforcement status.
 *
 * Unknown states fail closed to an intercepted outcome unless the legacy action
 * explicitly records completed process quarantine.
 *
 * @param {TelemetryRecord} record - The raw telemetry record to normalize.
 * @returns {EnforcementStatus} A dashboard-supported containment state.
 * @complexity O(1) time and O(1) space.
 * @example
 * normalizeEnforcementStatus({ enforcementStatus: 'INTERCEPTED' });
 * // => 'INTERCEPTED'
 */
function normalizeEnforcementStatus(record: TelemetryRecord): EnforcementStatus {
  const enforcementStatus = record.enforcementStatus;

  if (
    enforcementStatus === 'AUTOMATED_QUARANTINE' ||
    enforcementStatus === 'INTERCEPTED' ||
    enforcementStatus === 'QUARANTINED'
  ) {
    return enforcementStatus;
  }

  return record.action === 'process_quarantined' ? 'QUARANTINED' : 'INTERCEPTED';
}

/**
 * Converts one unknown current or legacy ledger value into a security alert.
 *
 * @param {unknown} value - The untrusted ledger value to validate.
 * @param {number} alertIndex - The stable payload position used in fallback IDs.
 * @returns {SecurityAlert | undefined} A valid alert or `undefined` for malformed input.
 * @complexity O(L) time and space for fallback ID construction over path and timestamp length.
 * @example
 * normalizeAlert({ timestamp: '2026-01-01T00:00:00Z', targetProcessId: 42,
 *   attemptedAction: 'read_file', attemptedPath: '/tmp/file' }, 0);
 * // => a normalized SecurityAlert
 */
function normalizeAlert(value: unknown, alertIndex: number): SecurityAlert | undefined {
  if (!isTelemetryRecord(value)) {
    return undefined;
  }

  const attemptedAction = readString(value, 'attemptedAction', 'action');
  const attemptedPath = readString(value, 'attemptedPath', 'illegalPath');
  const timestamp = readString(value, 'timestamp');
  const legacyProcessId = value.pid;
  const targetProcessId =
    typeof value.targetProcessId === 'number' ? value.targetProcessId : legacyProcessId;

  if (
    attemptedAction === undefined ||
    attemptedPath === undefined ||
    timestamp === undefined ||
    typeof targetProcessId !== 'number' ||
    !Number.isSafeInteger(targetProcessId) ||
    targetProcessId <= 0
  ) {
    return undefined;
  }

  const recordId = readString(value, 'id');
  const originAttribution = readString(value, 'origin_attribution') ?? 'Ephemeral Shell Task';
  const triggerSignature = readString(value, 'triggerSignature') ?? 'PATH_BOUNDARY_ESCAPE';

  return {
    attemptedAction,
    attemptedPath,
    enforcementStatus: normalizeEnforcementStatus(value),
    id: recordId ?? `${timestamp}:${targetProcessId}:${attemptedPath}:${alertIndex}`,
    origin_attribution: originAttribution,
    targetProcessId,
    timestamp,
    triggerSignature,
  };
}

/**
 * Normalizes an API response into the dashboard's stable telemetry state.
 *
 * @param {unknown} payload - The untrusted telemetry endpoint response.
 * @returns {TelemetryState} Valid alerts and a non-negative active-process count.
 * @complexity O(A * L) time and O(A) space for A alerts with maximum field length L.
 * @example
 * normalizeTelemetryPayload({ activeProcessCount: 0, alerts: [] });
 * // => { activeProcessCount: 0, alerts: [] }
 */
function normalizeTelemetryPayload(payload: unknown): TelemetryState {
  const payloadRecord = isTelemetryRecord(payload) ? payload : undefined;
  const alertPayload = Array.isArray(payload) ? payload : payloadRecord?.alerts;
  const alerts = Array.isArray(alertPayload)
    ? alertPayload.flatMap((alert, index) => {
        const normalizedAlert = normalizeAlert(alert, index);

        return normalizedAlert === undefined ? [] : [normalizedAlert];
      })
    : [];
  const reportedProcessCount = payloadRecord?.activeProcessCount;
  const activeProcessCount =
    typeof reportedProcessCount === 'number' &&
    Number.isSafeInteger(reportedProcessCount) &&
    reportedProcessCount >= 0
      ? reportedProcessCount
      : 0;

  return { activeProcessCount, alerts };
}

/**
 * Selects previously unseen containment breakouts that are still brand new.
 *
 * The supplied ID set is updated in place and pruned to the currently fresh
 * breakout window so repeated telemetry polls do not replay notifications.
 *
 * @param {readonly SecurityAlert[]} alerts - The normalized newest-first telemetry alerts.
 * @param {number} currentTimeMs - The current Unix timestamp in milliseconds.
 * @param {Set<string>} notifiedAlertIds - The breakout IDs already toasted during the active window.
 * @returns {SecurityAlert[]} The fresh breakout alerts that require critical error toasts.
 * @complexity O(A + N) time for A alerts and N tracked IDs, with O(A) temporary space.
 * @example
 * selectFreshBreakoutAlerts([alert], Date.now(), new Set());
 * // => [alert] when the breakout timestamp is within ten seconds
 */
export function selectFreshBreakoutAlerts(
  alerts: readonly SecurityAlert[],
  currentTimeMs: number,
  notifiedAlertIds: Set<string>
): SecurityAlert[] {
  const freshBreakoutIds = new Set<string>();
  const unseenFreshBreakouts: SecurityAlert[] = [];

  for (const alert of alerts) {
    if (alert.attemptedAction !== 'filesystem_boundary_breakout') {
      continue;
    }

    const alertTimeMs = Date.parse(alert.timestamp);
    const alertAgeMs = currentTimeMs - alertTimeMs;

    if (
      !Number.isFinite(alertTimeMs) ||
      alertAgeMs < 0 ||
      alertAgeMs > BREAKOUT_TOAST_FRESHNESS_WINDOW_MS
    ) {
      continue;
    }

    freshBreakoutIds.add(alert.id);

    if (!notifiedAlertIds.has(alert.id)) {
      notifiedAlertIds.add(alert.id);
      unseenFreshBreakouts.push(alert);
    }
  }

  for (const notifiedAlertId of notifiedAlertIds) {
    if (!freshBreakoutIds.has(notifiedAlertId)) {
      notifiedAlertIds.delete(notifiedAlertId);
    }
  }

  return unseenFreshBreakouts;
}

/**
 * Displays one mode-aware containment breakout notification for eight seconds.
 *
 * @param {SecurityAlert} breakout - The fresh normalized breakout alert to display.
 * @param {boolean} auditOnly - Whether the process was allowed to continue for observation.
 * @returns {string | number} The Sonner-generated toast identifier.
 * @complexity O(L) time and space for the rendered path and PID description.
 * @example
 * showContainmentBreakoutToast(alert, true);
 * // => a Sonner toast identifier
 */
export function showContainmentBreakoutToast(
  breakout: SecurityAlert,
  auditOnly: boolean
): string | number {
  if (auditOnly) {
    return toast.warning(
      'Learning Loop: Process attempted a folder escape but was permitted to continue running.',
      {
        description: `PID ${String(breakout.targetProcessId)} attempted: ${formatAttemptedAction(breakout.attemptedAction)}.`,
        duration: 8_000,
      }
    );
  }

  return toast.error('CRITICAL: Boundary Breakout', {
    description: `PID ${String(breakout.targetProcessId)} triggered: ${formatAttemptedAction(breakout.attemptedAction)}. Status: ${formatEnforcementStatus(breakout.enforcementStatus)}.`,
    duration: 8_000,
  });
}

/**
 * Dismisses every currently visible desktop notification.
 *
 * @returns {void} No value; Sonner clears its active toast stack.
 * @complexity O(1) client dispatch time and O(1) auxiliary space.
 * @example
 * clearAlertToasts();
 * // => removes all active dashboard toasts
 */
export function clearAlertToasts(): void {
  toast.dismiss();
}

/**
 * Smoothly returns the browser viewport to the dashboard header.
 *
 * @returns {void} No value; the browser owns the animated viewport transition.
 * @complexity O(1) dispatch time and O(1) auxiliary space.
 * @example
 * scrollDashboardToTop();
 * // => scrolls the viewport to its top edge
 */
export function scrollDashboardToTop(): void {
  window.scrollTo({ behavior: 'smooth', top: 0 });
}

/**
 * Sends one operator-selected execution mode to the local dashboard API.
 *
 * @param {boolean} auditOnly - Whether native process termination should be disabled.
 * @returns {Promise<void>} Resolves after the native daemon confirms the mode update.
 * @complexity O(1) request construction with bounded local IPC response handling.
 * @example
 * await dispatchAuditModeUpdate(true);
 * // => native watchdog enters Audit-Only Mode
 */
export async function dispatchAuditModeUpdate(auditOnly: boolean): Promise<void> {
  const response = await fetch('/api/telemetry/audit-mode', {
    body: JSON.stringify({ auditOnly }),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Audit mode update failed with status ${response.status}.`);
  }
}

/**
 * Composes the AegisAgent command view from a global firewall status region,
 * active-process telemetry, and a stable newest-first security alert table.
 *
 * @returns {React.JSX.Element} The polling security dashboard page layout.
 * @example
 * <DashboardPage />
 * // => renders the status overview and intercepted-alert telemetry table
 */
export default function DashboardPage(): React.JSX.Element {
  const [auditOnly, setAuditOnly] = useState(true);
  const [isAuditModeUpdating, setIsAuditModeUpdating] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetryState>(EMPTY_TELEMETRY);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>('degraded');
  const notifiedBreakoutIds = useRef(new Set<string>());

  /**
   * Fetches, validates, publishes, and notifies on one telemetry snapshot.
   *
   * @param {AbortSignal} signal - The lifecycle signal used to cancel an obsolete request.
   * @returns {Promise<void>} Resolves after the dashboard state reflects the response.
   * @complexity O(A * L) time and O(A) space for A returned alerts of field length L.
   * @example
   * await refreshTelemetry(new AbortController().signal);
   * // => updates telemetry state after a successful local response
   */
  const refreshTelemetry = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      const response = await fetch('/api/telemetry', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal,
      });

      if (!response.ok) {
        throw new Error(`Telemetry request failed with status ${response.status}.`);
      }

      const payload: unknown = await response.json();
      const nextTelemetry = normalizeTelemetryPayload(payload);
      const freshBreakouts = selectFreshBreakoutAlerts(
        nextTelemetry.alerts,
        Date.now(),
        notifiedBreakoutIds.current
      );

      for (const breakout of freshBreakouts) {
        showContainmentBreakoutToast(breakout, auditOnly);
      }

      setTelemetry(nextTelemetry);
      setSystemStatus('operational');
    },
    [auditOnly]
  );

  /**
   * Optimistically updates the switch and synchronizes native execution state.
   *
   * @param {boolean} nextAuditOnly - The operator-selected switch state.
   * @returns {Promise<void>} Resolves after success or a handled rollback.
   * @complexity O(1) local state work plus bounded local API request time.
   * @example
   * await handleAuditModeChange(true);
   * // => enables audit-only operation or restores the previous switch state
   */
  const handleAuditModeChange = useCallback(async (nextAuditOnly: boolean): Promise<void> => {
    setAuditOnly(nextAuditOnly);
    setIsAuditModeUpdating(true);

    try {
      await dispatchAuditModeUpdate(nextAuditOnly);
      toast.success(nextAuditOnly ? 'Audit-Only Mode enabled' : 'Active Enforcement restored');
    } catch {
      setAuditOnly(!nextAuditOnly);
      toast.error('Execution mode update failed', {
        description: 'The native Krypton watchdog did not confirm the requested mode.',
      });
    } finally {
      setIsAuditModeUpdating(false);
    }
  }, []);

  /**
   * Starts the non-overlapping telemetry polling lifecycle and cleans it up on unmount.
   *
   * @returns {void} React owns the returned cleanup callback for this effect.
   * @complexity O(1) setup space; each poll inherits `refreshTelemetry` complexity.
   * @example
   * // Mounted DashboardPage instances poll immediately and every five seconds.
   */
  useEffect(() => {
    const abortController = new AbortController();
    let requestInFlight = false;

    /**
     * Executes one guarded poll without allowing overlapping requests.
     *
     * @returns {Promise<void>} Resolves after success, handled failure, or an overlap skip.
     * @complexity O(A * L) time and O(A) space through `refreshTelemetry`.
     * @example
     * await pollTelemetry();
     * // => refreshes once when no prior request is active
     */
    const pollTelemetry = async (): Promise<void> => {
      if (requestInFlight) {
        return;
      }

      requestInFlight = true;

      try {
        await refreshTelemetry(abortController.signal);
      } catch {
        if (!abortController.signal.aborted) {
          setSystemStatus('degraded');
        }
      } finally {
        requestInFlight = false;
      }
    };

    void pollTelemetry();
    const pollInterval = window.setInterval(() => void pollTelemetry(), TELEMETRY_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(pollInterval);
      abortController.abort();
    };
  }, [refreshTelemetry]);

  /**
   * Tracks whether the viewport has crossed the floating-navigation threshold.
   *
   * @returns {void} React owns the returned scroll-listener cleanup callback.
   * @complexity O(1) work and space per passive scroll event.
   * @example
   * // Scrolling below 300 pixels keeps the Back to Top control hidden.
   */
  useEffect(() => {
    /**
     * Synchronizes floating-button visibility with the current vertical offset.
     *
     * @returns {void} No value; React receives the next visibility state.
     * @complexity O(1) time and O(1) auxiliary space.
     * @example
     * handleWindowScroll();
     * // => shows the control when window.scrollY exceeds 300
     */
    const handleWindowScroll = (): void => {
      setIsVisible(window.scrollY > BACK_TO_TOP_VISIBILITY_THRESHOLD_PX);
    };

    window.addEventListener('scroll', handleWindowScroll, { passive: true });

    return () => window.removeEventListener('scroll', handleWindowScroll);
  }, []);

  return (
    <main
      className="min-h-screen bg-krypton-bg-main px-krypton-space-4 py-krypton-space-5 text-slate-100 sm:px-krypton-space-5 lg:px-krypton-space-6 lg:py-krypton-space-6"
      data-system-status={systemStatus}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="relative overflow-hidden rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface px-krypton-space-5 py-7 shadow-2xl shadow-black/30 sm:px-krypton-space-6">
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-cyan-400 via-blue-500 to-violet-500"
          />
          <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-400">
                Runtime boundary telemetry
              </p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
                AegisAgent Security Command
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Live containment visibility for monitored agent processes and filesystem enforcement
                events.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <div
                aria-busy={isAuditModeUpdating}
                className="flex items-center gap-krypton-space-3 rounded-krypton-radius-full border border-krypton-border-muted bg-krypton-bg-main/70 px-krypton-space-3 py-krypton-space-2"
              >
                <label
                  className="cursor-pointer text-xs font-bold uppercase tracking-wider text-slate-200"
                  htmlFor="audit-only-mode"
                >
                  Audit-Only Mode
                </label>
                <KryptonToggle
                  aria-label="Audit-Only Mode"
                  checked={auditOnly}
                  disabled={isAuditModeUpdating}
                  id="audit-only-mode"
                  onCheckedChange={(checked) => void handleAuditModeChange(checked)}
                  variant="warning"
                />
                <InfoTooltip
                  content="Audit-Only Mode records folder escapes and shows warnings without terminating the process, so you can observe normal workspace activity before enabling enforcement."
                  label="Audit-Only Mode"
                />
              </div>
              <p
                aria-live="polite"
                className={clsx(
                  'inline-flex w-fit items-center gap-krypton-space-2 rounded-krypton-radius-full border px-krypton-space-3 py-1.5 text-xs font-bold uppercase tracking-wider',
                  systemStatus === 'operational'
                    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                    : 'border-amber-400/40 bg-amber-400/10 text-amber-200'
                )}
              >
                <span
                  aria-hidden="true"
                  className={clsx(
                    'h-2 w-2 rounded-krypton-radius-full',
                    systemStatus === 'operational' ? 'bg-emerald-400' : 'bg-amber-300'
                  )}
                />
                Telemetry stream: {systemStatus}
              </p>
            </div>
          </div>
        </header>

        <section
          aria-labelledby="firewall-overview-title"
          className="flex flex-col gap-krypton-space-4 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-main/70 p-krypton-space-5 lg:flex-row lg:items-stretch lg:justify-between lg:p-krypton-space-5"
        >
          <div className="max-w-xl py-1">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              Engine overview
            </p>
            <h2 className="mt-2 text-xl font-bold text-white" id="firewall-overview-title">
              Active Workspace Protection
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Krypton maps file interactions inside your current folder directory and safely
              isolates malicious scripts before they can read or write data to other areas of your
              computer.
            </p>
          </div>
          <div className="w-full lg:max-w-md">
            <StatusCard
              activeProcessCount={telemetry.activeProcessCount}
              systemStatus={systemStatus}
            />
          </div>
        </section>

        <section aria-labelledby="threat-telemetry-title" className="space-y-4">
          <header className="flex items-end justify-between gap-4 px-1">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                Enforcement ledger
              </p>
              <h2 className="mt-1 text-xl font-bold text-white" id="threat-telemetry-title">
                Intercepted security alerts
              </h2>
            </div>
            <KryptonButton
              aria-label="Clear desktop alerts"
              onClick={clearAlertToasts}
              size="sm"
              variant="link"
            >
              Clear Alerts
            </KryptonButton>
          </header>
          <AlertTable alerts={telemetry.alerts} />
        </section>
      </div>
      <div
        aria-hidden={!isVisible}
        className={clsx(
          'fixed bottom-6 right-6 z-50 transform rounded-krypton-radius-control shadow-2xl transition-all duration-300 ease-in-out sm:bottom-8 sm:right-8',
          isVisible
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        )}
      >
        <KryptonIconButton
          aria-label="Back to top"
          icon={<ArrowUp />}
          onClick={scrollDashboardToTop}
          size="lg"
          tabIndex={isVisible ? 0 : -1}
          variant="secondary"
        />
      </div>
    </main>
  );
}

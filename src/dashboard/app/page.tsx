"use client";

import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";

import {
  AlertTable,
  type EnforcementStatus,
  type SecurityAlert,
} from "../components/features/AlertTable";
import {
  StatusCard,
  type SystemStatus,
} from "../components/ui/StatusCard";

const TELEMETRY_POLL_INTERVAL_MS = 5_000;

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

function isTelemetryRecord(value: unknown): value is TelemetryRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  record: TelemetryRecord,
  primaryKey: string,
  fallbackKey?: string,
): string | undefined {
  const primaryValue = record[primaryKey];

  if (typeof primaryValue === "string") {
    return primaryValue;
  }

  const fallbackValue =
    fallbackKey === undefined ? undefined : record[fallbackKey];

  return typeof fallbackValue === "string" ? fallbackValue : undefined;
}

function normalizeEnforcementStatus(
  record: TelemetryRecord,
): EnforcementStatus {
  const enforcementStatus = record.enforcementStatus;

  if (
    enforcementStatus === "INTERCEPTED" ||
    enforcementStatus === "QUARANTINED"
  ) {
    return enforcementStatus;
  }

  return record.action === "process_quarantined"
    ? "QUARANTINED"
    : "INTERCEPTED";
}

function normalizeAlert(
  value: unknown,
  alertIndex: number,
): SecurityAlert | undefined {
  if (!isTelemetryRecord(value)) {
    return undefined;
  }

  const attemptedAction = readString(value, "attemptedAction", "action");
  const attemptedPath = readString(value, "attemptedPath", "illegalPath");
  const timestamp = readString(value, "timestamp");
  const legacyProcessId = value.pid;
  const targetProcessId =
    typeof value.targetProcessId === "number"
      ? value.targetProcessId
      : legacyProcessId;

  if (
    attemptedAction === undefined ||
    attemptedPath === undefined ||
    timestamp === undefined ||
    typeof targetProcessId !== "number" ||
    !Number.isSafeInteger(targetProcessId) ||
    targetProcessId <= 0
  ) {
    return undefined;
  }

  const recordId = readString(value, "id");
  const triggerSignature =
    readString(value, "triggerSignature") ?? "PATH_BOUNDARY_ESCAPE";

  return {
    attemptedAction,
    attemptedPath,
    enforcementStatus: normalizeEnforcementStatus(value),
    id:
      recordId ??
      `${timestamp}:${targetProcessId}:${attemptedPath}:${alertIndex}`,
    targetProcessId,
    timestamp,
    triggerSignature,
  };
}

function normalizeTelemetryPayload(payload: unknown): TelemetryState {
  const payloadRecord = isTelemetryRecord(payload) ? payload : undefined;
  const alertPayload = Array.isArray(payload)
    ? payload
    : payloadRecord?.alerts;
  const alerts = Array.isArray(alertPayload)
    ? alertPayload.flatMap((alert, index) => {
        const normalizedAlert = normalizeAlert(alert, index);

        return normalizedAlert === undefined ? [] : [normalizedAlert];
      })
    : [];
  const reportedProcessCount = payloadRecord?.activeProcessCount;
  const activeProcessCount =
    typeof reportedProcessCount === "number" &&
    Number.isSafeInteger(reportedProcessCount) &&
    reportedProcessCount >= 0
      ? reportedProcessCount
      : 0;

  return { activeProcessCount, alerts };
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
  const [telemetry, setTelemetry] = useState<TelemetryState>(EMPTY_TELEMETRY);
  const [systemStatus, setSystemStatus] =
    useState<SystemStatus>("degraded");

  const refreshTelemetry = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      const response = await fetch("/api/telemetry", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal,
      });

      if (!response.ok) {
        throw new Error(
          `Telemetry request failed with status ${response.status}.`,
        );
      }

      const payload: unknown = await response.json();
      setTelemetry(normalizeTelemetryPayload(payload));
      setSystemStatus("operational");
    },
    [],
  );

  useEffect(() => {
    const abortController = new AbortController();
    let requestInFlight = false;

    const pollTelemetry = async (): Promise<void> => {
      if (requestInFlight) {
        return;
      }

      requestInFlight = true;

      try {
        await refreshTelemetry(abortController.signal);
      } catch {
        if (!abortController.signal.aborted) {
          setSystemStatus("degraded");
        }
      } finally {
        requestInFlight = false;
      }
    };

    void pollTelemetry();
    const pollInterval = window.setInterval(
      () => void pollTelemetry(),
      TELEMETRY_POLL_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(pollInterval);
      abortController.abort();
    };
  }, [refreshTelemetry]);

  return (
    <main
      className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8 lg:py-8"
      data-system-status={systemStatus}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 px-6 py-7 shadow-2xl shadow-black/30 sm:px-8">
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
                Live containment visibility for monitored agent processes and
                filesystem enforcement events.
              </p>
            </div>
            <p
              aria-live="polite"
              className={clsx(
                "inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wider",
                systemStatus === "operational"
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                  : "border-amber-400/40 bg-amber-400/10 text-amber-200",
              )}
            >
              <span
                aria-hidden="true"
                className={clsx(
                  "h-2 w-2 rounded-full",
                  systemStatus === "operational"
                    ? "bg-emerald-400"
                    : "bg-amber-300",
                )}
              />
              Telemetry stream: {systemStatus}
            </p>
          </div>
        </header>

        <section
          aria-labelledby="firewall-overview-title"
          className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-5 lg:flex-row lg:items-stretch lg:justify-between lg:p-6"
        >
          <div className="max-w-xl py-1">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              Engine overview
            </p>
            <h2
              className="mt-2 text-xl font-bold text-white"
              id="firewall-overview-title"
            >
              Global firewall status
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Krypton continuously evaluates filesystem boundaries and isolates
              registered processes that violate containment policy.
            </p>
          </div>
          <div className="w-full lg:max-w-md">
            <StatusCard
              activeProcessCount={telemetry.activeProcessCount}
              systemStatus={systemStatus}
            />
          </div>
        </section>

        <section
          aria-labelledby="threat-telemetry-title"
          className="space-y-4"
        >
          <header className="flex flex-col justify-between gap-2 px-1 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                Enforcement ledger
              </p>
              <h2
                className="mt-1 text-xl font-bold text-white"
                id="threat-telemetry-title"
              >
                Intercepted security alerts
              </h2>
            </div>
            <p className="text-sm text-slate-500">
              Newest enforcement events appear first.
            </p>
          </header>
          <AlertTable alerts={telemetry.alerts} />
        </section>
      </div>
    </main>
  );
}

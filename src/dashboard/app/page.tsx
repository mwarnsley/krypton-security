"use client";

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
  readonly activeProcessCount: number;
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
 * @complexity O(N) time and O(N) space per changed telemetry response containing N alerts; O(1) between polling updates.
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
    <main className="dashboardPage" data-system-status={systemStatus}>
      <header className="dashboardPage__header">
        <p className="dashboardPage__eyebrow">Runtime boundary telemetry</p>
        <h1 className="dashboardPage__title">AegisAgent Security Command</h1>
        <p aria-live="polite" className="dashboardPage__connectionStatus">
          Telemetry stream: {systemStatus}
        </p>
      </header>

      <section
        aria-labelledby="firewall-overview-title"
        className="dashboardPage__statusRow"
      >
        <h2 id="firewall-overview-title">Global firewall status</h2>
        <StatusCard
          activeProcessCount={telemetry.activeProcessCount}
          systemStatus={systemStatus}
        />
      </section>

      <section
        aria-labelledby="threat-telemetry-title"
        className="dashboardPage__telemetry"
      >
        <header className="dashboardPage__sectionHeader">
          <h2 id="threat-telemetry-title">Intercepted security alerts</h2>
          <p>Newest enforcement events appear first.</p>
        </header>
        <AlertTable alerts={telemetry.alerts} />
      </section>
    </main>
  );
}

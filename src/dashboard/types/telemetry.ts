export type EnforcementStatus = 'AUTOMATED_QUARANTINE' | 'INTERCEPTED' | 'OBSERVED' | 'QUARANTINED';

export type TelemetrySeverity = 'critical' | 'high' | 'info' | 'low' | 'medium';

export type TelemetrySource = 'mock' | 'native';

export type TelemetryFallbackReason =
  | 'attestation_failed'
  | 'daemon_unreachable'
  | 'ledger_invalid'
  | 'ledger_unavailable'
  | 'native_degraded';

export interface ProcessIdentityPayload {
  /** The absolute executable path observed for this exact process generation. */
  readonly executablePath: string;

  /** The parent process identifier when the operating system reports one. */
  readonly parentPid: number | null;

  /** The positive operating-system process identifier. */
  readonly pid: number;

  /** The operating-system process start time used to detect PID reuse. */
  readonly startTime: number;
}

export interface SecurityAlert {
  /** Whether the event was process-attributed or emitted by the portable watcher. */
  readonly attribution: 'process' | 'unattributed';

  /** The denied or observed operation associated with the event. */
  readonly attemptedAction: string;

  /** The normalized filesystem or network target associated with the event. */
  readonly attemptedPath: string;

  /** The final containment state assigned by the Krypton engine. */
  readonly enforcementStatus: EnforcementStatus;

  /** The stable unique identifier used to preserve table-row identity. */
  readonly id: string;

  /** The dependency package, task, or local script attributed to the process. */
  readonly origin_attribution: string;

  /** The executable or developer tool responsible for the event. */
  readonly processName: string;

  /** The compound process generation when reliable attribution exists. */
  readonly process?: ProcessIdentityPayload;

  /** The monotonic native-ledger cursor, omitted only for demonstration events. */
  readonly sequence?: number;

  /** The normalized operator-facing risk tier for the event. */
  readonly severity: TelemetrySeverity;

  /** The operating-system process identifier associated with the event. */
  readonly targetProcessId: number | null;

  /** The ISO-8601 timestamp recorded when the security event occurred. */
  readonly timestamp: string;

  /** The deterministic policy signature that triggered the event. */
  readonly triggerSignature: string;
}

export interface TelemetryPage {
  /** Whether additional events remain beyond this bounded page. */
  readonly hasMore: boolean;

  /** The highest native sequence returned to the client. */
  readonly nextAfter?: number;
}

export interface NativeDaemonHealth {
  /** Native IPC readiness. */
  readonly ipc: 'ready' | 'write_failed';

  /** Durable telemetry-ledger readiness. */
  readonly ledger: 'ready' | 'write_failed';

  /** The current enforcement policy mode. */
  readonly mode: 'active_enforcement' | 'audit_only';

  /** Aggregated health status. */
  readonly status: 'degraded' | 'healthy';

  /** Portable watcher readiness. */
  readonly watcher: 'ready' | 'write_failed';
}

export interface TelemetryResponse extends TelemetryPage {
  /** The number of exact process generations registered with the native daemon. */
  readonly activeProcessCount: number;

  /** The bounded telemetry events included in this page. */
  readonly alerts: readonly SecurityAlert[];

  /** Why demonstration data replaced native telemetry. */
  readonly fallbackReason?: TelemetryFallbackReason;

  /** The server generation time for stale-response rejection. */
  readonly generatedAt: string;

  /** Structured daemon health when a native health request succeeded. */
  readonly health?: NativeDaemonHealth;

  /** Whether authenticated daemon health completed successfully. */
  readonly nativeDaemonReachable: boolean;

  /** Whether alerts are native evidence or deterministic demonstration data. */
  readonly source: TelemetrySource;
}

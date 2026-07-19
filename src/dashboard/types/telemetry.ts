export type EnforcementStatus = 'AUTOMATED_QUARANTINE' | 'INTERCEPTED' | 'OBSERVED' | 'QUARANTINED';

export type TelemetrySeverity = 'critical' | 'high' | 'info' | 'low' | 'medium';

export interface SecurityAlert {
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

  /** The normalized operator-facing risk tier for the event. */
  readonly severity: TelemetrySeverity;

  /** The operating-system process identifier associated with the event. */
  readonly targetProcessId: number;

  /** The ISO-8601 timestamp recorded when the security event occurred. */
  readonly timestamp: string;

  /** The deterministic policy signature that triggered the event. */
  readonly triggerSignature: string;
}

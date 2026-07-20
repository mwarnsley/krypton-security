import type { NativeDaemonHealth, ProcessIdentityPayload } from './telemetry';

export const NATIVE_CONTROL_PROTOCOL_VERSION = 1;

export type NativeControlCommand =
  | { readonly type: 'health' }
  | { readonly enabled: boolean; readonly type: 'set_audit_mode' }
  | { readonly process: ProcessIdentityPayload; readonly type: 'register_process' }
  | { readonly process: ProcessIdentityPayload; readonly type: 'unregister_process' }
  | { readonly process: ProcessIdentityPayload; readonly type: 'isolate_process' };

export interface NativeControlRequest {
  /** Per-daemon secret loaded from a user-only file. */
  readonly capability: string;

  /** Narrow command and validated payload. */
  readonly command: NativeControlCommand;

  /** Current native-control protocol version. */
  readonly protocolVersion: typeof NATIVE_CONTROL_PROTOCOL_VERSION;

  /** Unique request correlation identifier. */
  readonly requestId: string;
}

export interface NativeControlResponse {
  /** Exact registered process-generation count for health responses. */
  readonly activeProcessCount?: number;

  /** Stable machine-readable native outcome. */
  readonly code: string;

  /** Structured daemon health for health responses. */
  readonly health?: NativeDaemonHealth;

  /** Whether the native command completed successfully. */
  readonly ok: boolean;

  /** Native-control protocol version echoed by the daemon. */
  readonly protocolVersion: number;

  /** Correlation identifier echoed by the daemon. */
  readonly requestId: string;
}

export interface RuntimeEndpointRecord {
  /** User-only file containing the daemon capability. */
  readonly capabilityFile: string;

  /** Workspace-specific Unix-domain socket path. */
  readonly endpoint: string;

  /** Native daemon process identifier. */
  readonly pid: number;

  /** Native-control protocol version accepted by the daemon. */
  readonly protocolVersion: number;

  /** ISO-8601 daemon start time. */
  readonly startedAt: string;
}

export type NativeControlErrorCode =
  | 'unavailable'
  | 'permission_denied'
  | 'invalid_response'
  | 'transport_failed'
  | 'timeout'
  | 'disconnected'
  | 'isolation_rejected';

export class NativeControlError extends Error {
  readonly code: NativeControlErrorCode;
  constructor(code: NativeControlErrorCode, message: string);
}
export const NATIVE_TIMEOUT_MS: 1500;
export function discoverNativeEndpoint(projectRoot?: string): Promise<Record<string, unknown>>;

export interface ProcessIdentityPayload {
  executablePath: string;
  parentPid: number | null;
  pid: number;
  startTime: number;
}

export interface ProtectedChildLifecycle {
  kill(signal?: NodeJS.Signals): unknown;
  on(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  pid?: number | undefined;
}

export function dispatchNativeControl(
  command: Record<string, unknown>,
  projectRoot?: string
): Promise<Record<string, unknown>>;
export function getActiveWorkspaceProcessCount(): number;
export function inspectProcessIdentity(pid: number): Promise<ProcessIdentityPayload>;

export function quarantineProcess(
  identity: ProcessIdentityPayload,
  dependencies?: {
    dispatch?: (command: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }
): Promise<Record<string, unknown>>;

/** @deprecated PID-only registration is disabled; use spawnProtectedProcess. */
export function registerWorkspaceProcess(pid: number): never;
export function spawnProtectedProcess(
  command: string,
  args?: readonly string[],
  options?: import('node:child_process').SpawnOptions & { maxRuntimeMs?: number },
  dependencies?: {
    spawn?: (
      command: string,
      args: readonly string[],
      options: import('node:child_process').SpawnOptions
    ) => ProtectedChildLifecycle;
    inspect?: (pid: number) => Promise<ProcessIdentityPayload>;
    dispatch?: (command: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }
): Promise<import('node:child_process').ChildProcess>;

export function unregisterWorkspaceProcess(pid: number): void;

export interface ProtectedProcessOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  identity: ProcessIdentityPayload | undefined;
  spawnError: Error | undefined;
  registrationError: Error | undefined;
  exitedBeforeRegistrationFailure: boolean;
  enforcementConfirmed: boolean;
  cleanupFailed: boolean;
  childMayBeRunning: boolean;
  terminationError?: NativeControlError | undefined;
  isolationError?: NativeControlError | undefined;
  cleanupError?: NativeControlError | undefined;
  receiptError?: NativeControlError | undefined;
}
export interface ProtectedProcessSession {
  child: import('node:child_process').ChildProcess;
  registered: Promise<ProcessIdentityPayload>;
  completed: Promise<ProtectedProcessOutcome>;
}
export function startProtectedProcess(
  command: string,
  args?: readonly string[],
  options?: Parameters<typeof spawnProtectedProcess>[2],
  dependencies?: Parameters<typeof spawnProtectedProcess>[3]
): ProtectedProcessSession;

import type * as fs from 'node:fs/promises';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type { dispatchNativeControl } from './processIsolation.cjs';
import type { SupervisorWorkspace } from './supervisor.cjs';

export type DaemonStartupErrorCode =
  | 'binary_missing'
  | 'binary_unsafe'
  | 'log_unavailable'
  | 'daemon_unhealthy'
  | 'startup_failed'
  | 'startup_timeout'
  | 'startup_cancelled'
  | 'cleanup_failed';
export class DaemonStartupError extends Error {
  readonly code: DaemonStartupErrorCode;
  constructor(code: DaemonStartupErrorCode);
}
export const STARTUP_BUDGET_MS: 3000;
export interface DaemonStartupDependencies {
  fs?: typeof fs;
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  dispatch?: typeof dispatchNativeControl;
  uid?: number;
  targetDirectory?: string;
  signals?: EventEmitter;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout> | undefined) => void;
}
export function ensureNativeDaemon(
  workspace: SupervisorWorkspace,
  dependencies?: DaemonStartupDependencies
): Promise<void>;

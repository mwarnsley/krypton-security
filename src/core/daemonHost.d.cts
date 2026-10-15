import type { ChildProcess } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type { Writable } from 'node:stream';

/** Maximum combined native stdout and stderr bytes per fresh host log. */
export const MAX_LOG_BYTES: 65536;
/** Milliseconds allowed for each termination, reap and log operation. */
export const SHUTDOWN_GRACE_MS: 1500;

export interface DaemonHostDependencies {
  /** Returns the exact child to own; no other PID may be signaled. */
  spawn?: (
    binaryPath: string,
    args: string[],
    options: { shell: false; stdio: ['ignore', 'pipe', 'pipe'] }
  ) => Pick<ChildProcess, 'pid' | 'stdout' | 'stderr' | 'kill' | 'unref' | 'on' | 'once'>;
  /** Owns inherited fd 3 by default; caller provides a fresh empty private file. */
  createLog?: () => Writable;
  /** Process signal and terminal-failure source; defaults to the host process. */
  signals?: EventEmitter;
}

/** Resolves to native status, 2 for invalid input, or 1 on host/cleanup failure. */
export function runDaemonHost(
  binaryPath: string,
  dependencies?: DaemonHostDependencies
): Promise<number>;

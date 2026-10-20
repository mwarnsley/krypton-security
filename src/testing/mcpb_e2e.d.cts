import type * as fs from 'node:fs/promises';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { Socket } from 'node:net';

/** Separate absolute budget for owned-tree validation and removal, in milliseconds. */
export const CLEANUP_BUDGET_MS: 6000;
/** A fresh input is pinned only after its ctime is quiet this long, in milliseconds. */
export const INPUT_SETTLE_QUIET_MS: 4000;
/** Bounded wait for a fresh input's metadata to settle before `input_unsettled`. */
export const INPUT_SETTLE_BUDGET_MS: 10000;

export type PackagedE2EErrorCode =
  | 'unsafe_input'
  | 'input_unsettled'
  | 'size_limit'
  | 'input_failed'
  | 'archive_invalid'
  | 'cleanup_failed'
  | 'extraction_timeout'
  | 'extraction_failed'
  | 'child_failed'
  | 'output_limit'
  | 'protocol_failed'
  | 'scenario_timeout'
  | 'scenario_failed'
  | 'receipt_invalid'
  | 'socket_failed'
  | 'telemetry_invalid'
  | 'unsupported_platform'
  | 'operation_timeout'
  | 'operation_failed';
/** Stable redacted error; no archive paths, capabilities, or child output are retained. */
export class PackagedE2EError extends Error {
  readonly code: PackagedE2EErrorCode;
  constructor(code: PackagedE2EErrorCode);
}
/** Host effects are injectable; tests need neither release binaries nor a daemon. */
export interface PackagedE2EDependencies {
  fs?: Partial<typeof fs>;
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  connect?: (socketPath: string) => Socket;
  now?: () => number;
  /** Epoch milliseconds compared with the input's ctime while it settles; defaults to Date.now. */
  wallClock?: () => number;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  report?: (message: string) => void;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Canonical, existing temporary parent; defaults to the short macOS /private/tmp. */
  temporaryDirectory?: string;
}
/** Rejects unsafe artifacts or failed scenarios under one 45-second total deadline; cleanup is separate. */
export function runPackagedMcpbE2E(
  bundlePath: string,
  dependencies?: PackagedE2EDependencies
): Promise<void>;

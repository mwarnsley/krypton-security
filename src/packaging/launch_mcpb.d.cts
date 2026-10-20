import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { Writable } from 'node:stream';
import type { EventEmitter } from 'node:events';
import type { prepareStandaloneRuntime } from './mcpb_runtime.cjs';
import type { dispatchNativeControl, discoverNativeEndpoint } from '../core/processIsolation.cjs';
import type { serve } from '../core/mcp/server.cjs';

export type LauncherErrorCode =
  | 'native_exited'
  | 'native_failed'
  | 'native_busy'
  | 'native_unhealthy'
  | 'readiness_timeout'
  | 'readiness_failed'
  | 'readiness_cancelled'
  | 'cleanup_failed'
  | 'unsupported_platform'
  | 'server_failed'
  | 'service_timeout'
  | 'operation_failed'
  | 'output_timeout'
  | 'output_failed'
  | 'unexpected_failure';
export class LauncherError extends Error {
  readonly code: LauncherErrorCode;
  constructor(code: LauncherErrorCode);
}

/** Event-only host stdin is supported; an async iterator is intentionally not required. */
export interface LauncherInput extends EventEmitter {
  readonly destroyed?: boolean;
  readonly readableEnded?: boolean;
  pause(): unknown;
  resume(): unknown;
  destroy(): unknown;
}
export interface LauncherOptions {
  configuredWorkspace?: string;
  bundleRoot?: string;
  /** Explicit locally built daemon for the source CLI; bundles keep checksum validation. */
  nativeBinaryPath?: string;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  input?: LauncherInput;
  output?: Writable;
}
export interface LauncherDependencies {
  prepareRuntime?: typeof prepareStandaloneRuntime;
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  dispatch?: typeof dispatchNativeControl;
  /** Reads validated private discovery; its PID must match the exact live spawned child. */
  discover?: typeof discoverNativeEndpoint;
  serve?: typeof serve;
  /** Monotonic milliseconds; production uses performance.now(). */
  now?: () => number;
  /** Test delays must honor cancellation without retaining open handles after abort. */
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}
export type ReadinessDependencies = Pick<
  LauncherDependencies,
  'dispatch' | 'discover' | 'now' | 'delay'
>;
export type CleanupDependencies = Pick<LauncherDependencies, 'delay'>;
/**
 * Waits for stale discovery to match the live owned child before dispatching health.
 * Rejects with a stable category after child exit, twenty attempts, or five seconds.
 */
export function waitForNativeReady(
  runtimeHome: string,
  child: ChildProcess,
  dependencies?: ReadinessDependencies
): Promise<void>;
/** Idempotent per exact child; rejects with cleanup_failed after bounded TERM/KILL reaping. */
export function terminateOwnedDaemon(
  child: ChildProcess,
  dependencies?: CleanupDependencies
): Promise<void>;
/** Returns 0 on EOF/completion/signals or 1 on failure; the executable owns terminal diagnostics. */
export function runStandaloneMcpb(
  options?: LauncherOptions,
  dependencies?: LauncherDependencies
): Promise<number>;

/** Owns terminal diagnostics and exact-child cleanup for executable launchers. */
export function launchStandaloneMcpb(options?: LauncherOptions, argv?: string[]): Promise<void>;

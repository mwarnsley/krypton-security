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
  | 'native_unreachable'
  | 'native_unauthorized'
  | 'native_owner_lost'
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
  /**
   * Reads validated private discovery. An owner's PID must match its exact live spawned child;
   * an attached session compares it for stability only. It is never signaling authority.
   */
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
/**
 * Waits for a healthy daemon owned by another launch of the same private runtime home.
 * Authenticates through private discovery and capability only; the discovered PID is compared,
 * never signaled. Rejects native_unreachable when nothing answered within five seconds, and
 * native_unauthorized when stable discovery rejects the capability.
 */
export function waitForNativeAttach(
  runtimeHome: string,
  dependencies?: ReadinessDependencies
): Promise<void>;
/**
 * Attached-session supervision, one health probe in flight per second. Resolves `lost` on an
 * unreachable or capability-rejecting daemon and `cancelled` on abort; timeouts and degraded
 * health keep serving. Other failures reject native_unhealthy.
 */
export function watchAttachedDaemon(
  runtimeHome: string,
  signal: AbortSignal,
  dependencies?: Pick<LauncherDependencies, 'dispatch' | 'delay'>
): Promise<'lost' | 'cancelled'>;
/** Idempotent per exact child; rejects with cleanup_failed after bounded TERM/KILL reaping. */
export function terminateOwnedDaemon(
  child: ChildProcess,
  dependencies?: CleanupDependencies
): Promise<void>;
/**
 * Returns 0 on EOF/completion/signals or 1 on failure; the executable owns terminal diagnostics.
 * A launch that loses the native lock election attaches to the winner without owning it, and
 * takes over (at most two rounds per loss) if that owner exits.
 */
export function runStandaloneMcpb(
  options?: LauncherOptions,
  dependencies?: LauncherDependencies
): Promise<number>;

/** Owns terminal diagnostics and exact-child cleanup for executable launchers. */
export function launchStandaloneMcpb(options?: LauncherOptions, argv?: string[]): Promise<void>;

/**
 * Exits a host-loaded process with the settled launcher status; a directly executed entry
 * (`require.main`) is left to exit naturally. Never rejects.
 */
export function settleHostEntry(
  launched: Promise<void>,
  hostLoaded: boolean,
  exit?: (code: number) => void
): Promise<void>;

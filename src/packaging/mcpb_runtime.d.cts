export type StandaloneRuntimeErrorCode =
  | 'unsupported_platform'
  | 'invalid_workspace'
  | 'unsafe_state'
  | 'invalid_binary'
  | 'input_invalid'
  | 'size_limit'
  | 'output_failed'
  | 'cleanup_failed'
  | 'durability_unknown';

/** A bounded, redacted failure. After durability_unknown, inspect state before retrying. */
export class StandaloneRuntimeError extends Error {
  readonly code: StandaloneRuntimeErrorCode;
  constructor(code: StandaloneRuntimeErrorCode);
}
export interface StandaloneRuntimeOptions {
  bundleRoot: string;
  /** Explicit trusted local build; absent for checksum-verified MCPB binaries. */
  nativeBinaryPath?: string;
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  homeDirectory: string;
  configuredWorkspace?: string;
  /** Test-only override of the exact KryptonSecurity root, beneath a canonical existing parent. */
  applicationSupportRoot?: string;
  /** Test-only temporary trust anchor; production uses canonical os.tmpdir(). */
  temporaryDirectory?: string;
}
export interface StandaloneRuntimePaths {
  protectedWorkspaceRoot: string;
  /** Ephemeral private home under the short temporary runtime namespace. */
  runtimeHome: string;
  runtimeDirectory: string;
  telemetryPath: string;
  configPath: string;
  daemonPath: string;
  workspaceId: string;
}
/**
 * Only omitted/blank values, or the exact unexpanded `${user_config.protected_workspace_root}`
 * reference, create the fallback. Other templates and invalid values fail closed.
 */
export function resolveProtectedWorkspace(
  configuredValue: unknown,
  applicationSupportRoot: string
): Promise<{ path: string; usedFallback: boolean }>;
/** Validates the host, workspace and private state, then atomically publishes verified files. */
export function prepareStandaloneRuntime(
  options: StandaloneRuntimeOptions
): Promise<StandaloneRuntimePaths>;

export type SetupErrorCode =
  | 'unsupported_platform'
  | 'invalid_config_home'
  | 'invalid_config_file'
  | 'config_too_large'
  | 'unsafe_client_directory'
  | 'unsafe_config_directory'
  | 'invalid_json_shape'
  | 'server_name_conflict'
  | 'config_changed_during_setup'
  | 'durability_unknown'
  | 'write_failed'
  | 'cleanup_failed';

export class SetupError extends Error {
  readonly code: SetupErrorCode;
  constructor(code: SetupErrorCode, cause?: unknown);
}
export interface SetupOptions {
  homeDir?: string;
  platform?: string;
  configHome?: string;
  write?: (text: string) => unknown;
  writeError?: (text: string) => unknown;
}
export type SetupResult =
  | { client: string; status: 'configured'; reason: 'supervisor_installed' }
  | { client: string; status: 'skipped'; reason: 'not_detected' | 'already_configured' }
  | {
      client: string;
      status: 'failed';
      reason: SetupErrorCode | 'invalid_json' | 'filesystem_error';
    };
export function setupClients(options?: SetupOptions): Promise<SetupResult[]>;
export function main(argv?: string[], options?: SetupOptions): Promise<number>;

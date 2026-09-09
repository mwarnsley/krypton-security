export type PackagingErrorCode =
  | 'input_invalid'
  | 'dependency_invalid'
  | 'unsafe_input'
  | 'size_limit'
  | 'output_failed'
  | 'durability_unknown'
  | 'cleanup_failed';
export class PackagingError extends Error {
  readonly code: PackagingErrorCode;
  constructor(code: PackagingErrorCode, cause?: unknown);
}
export function createManifest(version: string): {
  manifest_version: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: { name: string; url: string };
  license: string;
  server: {
    type: string;
    entry_point: string;
    mcp_config: {
      command: string;
      args: string[];
      env: { KRYPTON_PROJECT_ROOT: string };
    };
  };
  tools: { name: string; description: string }[];
  tools_generated: boolean;
  compatibility: { platforms: string[]; runtimes: { node: string } };
  user_config: {
    project_root: { type: string; title: string; description: string; required: boolean };
  };
};
export function buildBundle(
  projectRoot?: string
): Promise<{ path: string; sha256: string; files: number }>;

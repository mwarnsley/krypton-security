export type ReleaseErrorCode =
  | 'invalid_version'
  | 'invalid_directory'
  | 'invalid_inventory'
  | 'invalid_artifact'
  | 'artifact_changed'
  | 'checksum_mismatch'
  | 'checksum_write_failed'
  | 'checksum_verify_failed'
  | 'output_failed';

/** Safe diagnostic category; cause may contain private OS details and must not be rendered. */
export class ReleaseError extends Error {
  readonly code: ReleaseErrorCode;
  constructor(code: ReleaseErrorCode, cause?: unknown);
}

export interface ReleaseChecksum {
  readonly name: string;
  readonly sha256: string;
}

/** Throws ReleaseError unless tag is canonical v-prefixed SemVer matching version exactly. */
export function validateReleaseTag(tag: unknown, version: unknown): string;

/** Exclusive creation; failure may leave partial outputs. Retry only in fresh disposable state. */
export function writeChecksums(directory: string): Promise<readonly ReleaseChecksum[]>;

/** Requires exactly three regular artifacts and four matching checksum files, with no writers. */
export function verifyChecksums(directory: string): Promise<readonly ReleaseChecksum[]>;

export interface ZipEntry {
  /** Relative, portable file path using forward slashes. */
  readonly name: string;
  /** File content, bounded to 128 MiB. */
  readonly data: Buffer;
}

export class ZipError extends Error {
  readonly code: 'invalid_entry' | 'size_limit';
  constructor(code: 'invalid_entry' | 'size_limit');
}

/**
 * Creates a deterministic stored ZIP with fixed 1980-01-01 dates and regular
 * 0644 files. Rejects unsafe or colliding extraction paths with ZipError;
 * bounds entries to 2048, names to 1024 UTF-8 bytes, each file to 128 MiB,
 * and total data to 256 MiB.
 */
export function createZip(entries: readonly ZipEntry[]): Buffer;

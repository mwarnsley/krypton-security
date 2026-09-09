const { createHash } = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { runCli } = require('../src/cli/runtime.cjs');

const ARTIFACTS = Object.freeze([
  'krypton-core-native-aarch64-apple-darwin',
  'krypton-core-native-x86_64-apple-darwin',
  'krypton-protected-fs.mcpb',
]);
const OUTPUTS = Object.freeze([...ARTIFACTS.map((name) => `${name}.sha256`), 'SHA256SUMS']);
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Safe release failures retain causes for callers but never render them to the CLI. */
class ReleaseError extends Error {
  constructor(code, cause) {
    super(`Release validation failed: ${code}.`, { cause });
    this.name = 'ReleaseError';
    this.code = code;
  }
}

/**
 * Requires a canonical v-prefixed SemVer tag matching package.json byte for byte.
 * No normalization or numeric conversion is permitted. Inputs are limited to 256 bytes.
 * @param {unknown} tag - Release tag from trusted workflow environment.
 * @param {unknown} version - Root package version.
 * @returns {string} Validated package version; throws ReleaseError on rejection.
 */
function validateReleaseTag(tag, version) {
  if (
    typeof tag !== 'string' ||
    typeof version !== 'string' ||
    tag.length > 256 ||
    version.length > 255 ||
    !/^[\x21-\x7e]+$/.test(tag) ||
    !/^[\x21-\x7e]+$/.test(version) ||
    !SEMVER.test(version) ||
    tag !== `v${version}`
  ) {
    throw new ReleaseError('invalid_version');
  }
  return version;
}

/** Checks a caller-selected directory without allowing lexical parent traversal. */
async function resolveDirectory(directory) {
  if (
    typeof directory !== 'string' ||
    directory.length === 0 ||
    directory.length > 4096 ||
    /[\0\r\n\\]/.test(directory) ||
    directory.split('/').includes('..')
  ) {
    throw new ReleaseError('invalid_directory');
  }
  const resolved = path.resolve(directory);
  const metadata = await fs.lstat(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new ReleaseError('invalid_directory');
  }
  return resolved;
}

/** Reads no more than eight directory entries, rejecting all unexpected names. */
async function checkInventory(directory, expected) {
  const entries = await fs.opendir(directory, { bufferSize: 8 });
  const remaining = new Set(expected);
  try {
    for (let count = 0; count <= expected.length; count += 1) {
      const entry = await entries.read();
      if (entry === null) {
        if (remaining.size !== 0) throw new ReleaseError('invalid_inventory');
        return;
      }
      if (!entry.isFile() || !remaining.delete(entry.name)) {
        throw new ReleaseError('invalid_inventory');
      }
    }
    throw new ReleaseError('invalid_inventory');
  } finally {
    await entries.close();
  }
}

/** Ensures descriptor and path still refer to the unchanged regular file. */
function unchanged(before, after) {
  return (
    after.isFile() &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

/**
 * Streams a regular no-follow file through a fixed 64 KiB buffer, enforcing the
 * size bound before and during reads and checking metadata again after EOF.
 * The isolated CI staging directory must have no concurrent writers; these
 * checks detect ordinary replacement but cannot prevent hostile same-user races.
 */
async function readBounded(filePath, limit, consume) {
  const handle = await fs.open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > limit) {
      throw new ReleaseError('invalid_artifact');
    }
    const buffer = Buffer.alloc(Math.min(64 * 1024, limit + 1));
    let total = 0;
    while (total <= limit) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, limit + 1 - total),
        null
      );
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > limit) throw new ReleaseError('invalid_artifact');
      consume(buffer.subarray(0, bytesRead));
    }
    if (
      total !== before.size ||
      !unchanged(before, await handle.stat()) ||
      !unchanged(before, await fs.lstat(filePath))
    ) {
      throw new ReleaseError('artifact_changed');
    }
  } finally {
    await handle.close();
  }
}

/** Hashes the fixed ASCII-sorted artifact list in O(total bytes), O(64 KiB) space. */
async function hashArtifacts(directory) {
  const checksums = [];
  for (const name of ARTIFACTS) {
    const hash = createHash('sha256');
    await readBounded(path.join(directory, name), MAX_ARTIFACT_BYTES, (chunk) =>
      hash.update(chunk)
    );
    checksums.push({ name, sha256: hash.digest('hex') });
  }
  return checksums;
}

/** Generates exact shasum-compatible bytes without parsing untrusted filenames. */
function checksumOutputs(checksums) {
  const lines = checksums.map(({ name, sha256 }) => `${sha256}  ${name}\n`);
  return [
    ...checksums.map(({ name }, index) => ({ name: `${name}.sha256`, content: lines[index] })),
    { name: 'SHA256SUMS', content: lines.join('') },
  ];
}

/** Verifies checksums as exact bounded bytes; checksum text never selects a path. */
async function verifyDirectory(directory) {
  await checkInventory(directory, [...ARTIFACTS, ...OUTPUTS]);
  const checksums = await hashArtifacts(directory);
  for (const { name, content } of checksumOutputs(checksums)) {
    const chunks = [];
    await readBounded(path.join(directory, name), 1024, (chunk) => chunks.push(Buffer.from(chunk)));
    if (!Buffer.concat(chunks).equals(Buffer.from(content))) {
      throw new ReleaseError('checksum_mismatch');
    }
  }
  await checkInventory(directory, [...ARTIFACTS, ...OUTPUTS]);
  return checksums;
}

/**
 * Creates four private, exclusive checksum outputs for exactly three artifacts.
 * Existing outputs are never overwritten. Failure may leave partial outputs;
 * discard this disposable staging directory before retrying. Primary files are
 * read only. The final verification must succeed before publication is allowed.
 * @param {string} directory - Fresh isolated CI artifact directory.
 * @returns {Promise<Array<{name: string, sha256: string}>>} Verified checksums.
 */
async function writeChecksums(directory) {
  try {
    const resolved = await resolveDirectory(directory);
    await checkInventory(resolved, ARTIFACTS);
    const checksums = await hashArtifacts(resolved);
    for (const { name, content } of checksumOutputs(checksums)) {
      const handle = await fs.open(path.join(resolved, name), 'wx', 0o600);
      try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    return await verifyDirectory(resolved);
  } catch (error) {
    throw error instanceof ReleaseError ? error : new ReleaseError('checksum_write_failed', error);
  }
}

/**
 * Rehashes the exact seven-file publication inventory and rejects any mismatch.
 * @param {string} directory - Isolated artifact directory without concurrent writers.
 * @returns {Promise<Array<{name: string, sha256: string}>>} Verified checksums.
 */
async function verifyChecksums(directory) {
  try {
    return await verifyDirectory(await resolveDirectory(directory));
  } catch (error) {
    throw error instanceof ReleaseError ? error : new ReleaseError('checksum_verify_failed', error);
  }
}

/** Bounded terminal output avoids indefinite backpressure on CLI diagnostics. */
async function writeStatus(stream, message) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stream.destroy();
      reject(new ReleaseError('output_failed'));
    }, 1500);
    try {
      stream.write(message, (error) => {
        clearTimeout(timer);
        if (error) reject(new ReleaseError('output_failed', error));
        else resolve();
      });
    } catch (error) {
      clearTimeout(timer);
      reject(new ReleaseError('output_failed', error));
    }
  });
}

module.exports = { ReleaseError, validateReleaseTag, writeChecksums, verifyChecksums };

if (require.main === module) {
  void runCli(async (argv) => {
    const [command, directory] = argv;
    if (!(
      (command === 'validate' && argv.length === 1) ||
      (['checksums', 'verify'].includes(command) && argv.length === 2)
    )) {
      await writeStatus(
        process.stderr,
        'Usage: node scripts/release-artifacts.cjs validate | checksums <directory> | verify <directory>\n'
      );
      return 2;
    }
    try {
      if (command === 'validate') {
        const chunks = [];
        await readBounded(path.resolve(__dirname, '../package.json'), 64 * 1024, (chunk) =>
          chunks.push(Buffer.from(chunk))
        );
        const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        validateReleaseTag(process.env.RELEASE_TAG, manifest?.version);
      } else if (command === 'checksums') {
        await writeChecksums(directory);
      } else {
        await verifyChecksums(directory);
      }
    } catch (error) {
      const code = error instanceof ReleaseError ? error.code : 'operation_failed';
      await writeStatus(process.stderr, `[KRYPTON] release ${code}; command failed closed.\n`);
      return 1;
    }
    await writeStatus(process.stdout, '[KRYPTON] release validation passed.\n');
    return 0;
  });
}

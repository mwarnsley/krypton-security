'use strict';

const MAX_ENTRIES = 2048;
const MAX_NAME_BYTES = 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
const UTF8_FLAG = 0x0800;
const DOS_DATE = 0x0021; // 1980-01-01; zero DOS time is midnight.

/** A bounded diagnostic that never embeds archive paths or file contents. */
class ZipError extends Error {
  /**
   * Creates a stable archive-validation failure.
   * @param {'invalid_entry' | 'size_limit'} code - Failure category.
   * @returns {ZipError} A safe diagnostic for the owning CLI boundary.
   */
  constructor(code) {
    super(code === 'size_limit' ? 'ZIP resource limit exceeded.' : 'ZIP entry validation failed.');
    this.name = 'ZipError';
    this.code = code;
  }
}

/**
 * Computes the ZIP IEEE CRC-32 for file contents.
 * @param {Buffer} data - Bounded file bytes.
 * @returns {number} Unsigned CRC-32.
 * @complexity O(B) time and O(1) auxiliary space for B bytes.
 * @example crc32(Buffer.from('123456789')); // => 0xcbf43926
 */
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Validates inputs and rejects ambiguous extraction paths before allocation.
 * @param {readonly {name: string, data: Buffer}[]} entries - Caller-owned files.
 * @returns {{entries: {name: Buffer, data: Buffer}[], size: number}} Byte-sorted
 * files and their full ZIP size; throws ZipError for invalid or excessive input.
 * @complexity O(B + N L log N + N L²) time and O(N L²) auxiliary space, for N
 * entries, maximum name length L, and B name bytes. Set lookup is average O(1);
 * ancestor substring creation/hashing adds the bounded L² term.
 * @example validateEntries([{name: '../secret', data: Buffer.alloc(0)}]); // throws
 */
function validateEntries(entries) {
  if (!Array.isArray(entries)) throw new ZipError('invalid_entry');
  if (entries.length > MAX_ENTRIES) throw new ZipError('size_limit');
  const files = new Set();
  const directories = new Set();
  const validated = [];
  let payload = 0;
  let size = 22;
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || !Buffer.isBuffer(entry.data)) {
      throw new ZipError('invalid_entry');
    }
    if (entry.name.length > MAX_NAME_BYTES || entry.data.length > MAX_FILE_BYTES) {
      throw new ZipError('size_limit');
    }
    const name = Buffer.from(entry.name, 'utf8');
    if (name.length > MAX_NAME_BYTES) throw new ZipError('size_limit');
    if (name.toString('utf8') !== entry.name) throw new ZipError('invalid_entry');
    const segments = entry.name.split('/');
    if (
      segments.some(
        (segment) =>
          segment === '' ||
          segment === '.' ||
          segment === '..' ||
          /[\\:*?"<>|\p{Cc}]/u.test(segment) ||
          /[. ]$/.test(segment) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
      )
    )
      throw new ZipError('invalid_entry');

    // Case and Unicode normalization collisions are unsafe on common macOS
    // extraction volumes. Preserve the supplied spelling only in the archive.
    const key = entry.name.normalize('NFC').toLowerCase();
    if (files.has(key) || directories.has(key)) throw new ZipError('invalid_entry');
    for (let slash = key.indexOf('/'); slash !== -1; slash = key.indexOf('/', slash + 1)) {
      const parent = key.slice(0, slash);
      if (files.has(parent)) throw new ZipError('invalid_entry');
      directories.add(parent);
    }
    files.add(key);
    payload += entry.data.length;
    if (payload > MAX_PAYLOAD_BYTES) throw new ZipError('size_limit');
    size += 30 + 46 + name.length * 2 + entry.data.length;
    validated.push({ name, data: entry.data });
  }
  validated.sort((left, right) => Buffer.compare(left.name, right.name));
  return { entries: validated, size };
}

/**
 * Serializes a bounded deterministic ZIP using PKWARE APPNOTE 6.3.10 records.
 * Stored files use UTF-8 names, fixed 1980 timestamps and Unix regular 0644
 * attributes. No filesystem access, compression, comments or extra fields occur.
 * All input/resource failures throw a redacted ZipError to the owning boundary.
 * Caller buffers must not be mutated concurrently during this synchronous call.
 * @param {readonly {name: string, data: Buffer}[]} entries - Files to package.
 * @returns {Buffer} An independent archive; throws ZipError on invalid input.
 * @complexity O(P + N L log N + N L²) time and O(P + N L²) space including output,
 * for P payload bytes, N entries and maximum name length L. All are hard-bounded.
 * @example createZip([{name: 'manifest.json', data: Buffer.from('{}')}]); // ZIP bytes
 * @see https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 */
function createZip(entries) {
  try {
    const validated = validateEntries(entries);
    const archive = Buffer.alloc(validated.size);
    const centralRecords = [];
    let offset = 0;
    for (const entry of validated.entries) {
      const checksum = crc32(entry.data);
      const localOffset = offset;
      archive.writeUInt32LE(0x04034b50, offset);
      archive.writeUInt16LE(20, offset + 4);
      archive.writeUInt16LE(UTF8_FLAG, offset + 6);
      archive.writeUInt16LE(DOS_DATE, offset + 12);
      archive.writeUInt32LE(checksum, offset + 14);
      archive.writeUInt32LE(entry.data.length, offset + 18);
      archive.writeUInt32LE(entry.data.length, offset + 22);
      archive.writeUInt16LE(entry.name.length, offset + 26);
      offset += 30;
      offset += entry.name.copy(archive, offset);
      offset += entry.data.copy(archive, offset);
      centralRecords.push({ ...entry, checksum, localOffset });
    }
    const centralOffset = offset;
    for (const entry of centralRecords) {
      archive.writeUInt32LE(0x02014b50, offset);
      archive.writeUInt16LE((3 << 8) | 20, offset + 4);
      archive.writeUInt16LE(20, offset + 6);
      archive.writeUInt16LE(UTF8_FLAG, offset + 8);
      archive.writeUInt16LE(DOS_DATE, offset + 14);
      archive.writeUInt32LE(entry.checksum, offset + 16);
      archive.writeUInt32LE(entry.data.length, offset + 20);
      archive.writeUInt32LE(entry.data.length, offset + 24);
      archive.writeUInt16LE(entry.name.length, offset + 28);
      archive.writeUInt32LE((0o100644 << 16) >>> 0, offset + 38);
      archive.writeUInt32LE(entry.localOffset, offset + 42);
      offset += 46;
      offset += entry.name.copy(archive, offset);
    }
    archive.writeUInt32LE(0x06054b50, offset);
    archive.writeUInt16LE(centralRecords.length, offset + 8);
    archive.writeUInt16LE(centralRecords.length, offset + 10);
    archive.writeUInt32LE(offset - centralOffset, offset + 12);
    archive.writeUInt32LE(centralOffset, offset + 16);
    return archive;
  } catch (error) {
    if (error instanceof ZipError) throw error;
    throw new ZipError(error instanceof RangeError ? 'size_limit' : 'invalid_entry');
  }
}

module.exports = { createZip, ZipError };

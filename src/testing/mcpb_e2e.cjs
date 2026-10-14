#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { performance } = require('node:perf_hooks');
const { runCli } = require('../cli/runtime.cjs');

const MIB = 1024 * 1024;
const MAX_ARCHIVE = 260 * MIB;
const MAX_ENTRIES = 2048;
const MAX_NAME = 1024;
const FRAME_BYTES = 32768;
const OUTPUT_BYTES = 65536;
const SCENARIO_MS = 15000;
const TOTAL_RUN_MS = 45000;
const NATIVE = {
  arm64: ['native/krypton-core-native-aarch64-apple-darwin', 0x0100000c],
  x64: ['native/krypton-core-native-x86_64-apple-darwin', 0x01000007],
};
const REQUIRED = new Set([
  'LICENSE',
  'README.md',
  'manifest.json',
  'package.json',
  'src/cli/runtime.cjs',
  'src/core/processIsolation.cjs',
  'src/core/mcp/server.cjs',
  'src/packaging/launch_mcpb.cjs',
  'src/packaging/mcpb_runtime.cjs',
  'native/native-binaries.json',
  ...Object.values(NATIVE).map(([name]) => name),
]);
const DEPENDENCIES = new Map([
  ['ajv', ['dist/', 'LICENSE']],
  ['fast-deep-equal', ['index.js', 'LICENSE']],
  ['fast-uri', ['index.js', 'lib/', 'LICENSE']],
  ['json-schema-traverse', ['index.js', 'LICENSE']],
  ['require-from-string', ['index.js', 'license']],
]);
const PASSES = [
  'Custom workspace',
  'Fallback workspace',
  'Traversal denial',
  'Telemetry durability',
  'Daemon cleanup',
];

/** Typed failures never retain private paths, child output, or raw exception messages. */
class PackagedE2EError extends Error {
  /** @param {import('./mcpb_e2e.cjs').PackagedE2EErrorCode} code Safe failure category. */
  constructor(code) {
    super(code);
    this.name = 'PackagedE2EError';
    this.code = code;
  }
}
function requireCheck(condition, code) {
  if (!condition) throw new PackagedE2EError(code);
}
function failure(error, code) {
  return error instanceof PackagedE2EError ? error : new PackagedE2EError(code);
}
function sameIdentity(a, b) {
  return ['dev', 'ino', 'mode', 'uid', 'gid'].every((key) => a[key] === b[key]);
}
function unchanged(a, b) {
  return (
    sameIdentity(a, b) && ['size', 'nlink', 'mtimeNs', 'ctimeNs'].every((key) => a[key] === b[key])
  );
}
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function decode(bytes, code) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw failure(error, code);
  }
}

/** Pins all components, so O_NOFOLLOW on the leaf cannot hide redirected parents. */
async function pin(file, io, limit, check) {
  const pins = new Map();
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    check?.();
    const stat = await io.lstat(current, { bigint: true });
    check?.();
    requireCheck(
      !stat.isSymbolicLink() &&
        (current === file ? stat.isFile() && stat.nlink === 1n : stat.isDirectory()),
      'unsafe_input'
    );
    pins.set(current, stat);
  }
  check?.();
  requireCheck((await io.realpath(file)) === file, 'unsafe_input');
  check?.();
  const stat = pins.get(file);
  requireCheck(stat.size <= BigInt(limit), 'size_limit');
  return { file, pins, stat };
}
async function recheck(input, io, check) {
  for (const [file, stat] of input.pins) {
    check?.();
    const after = await io.lstat(file, { bigint: true });
    check?.();
    requireCheck(
      file === input.file ? unchanged(stat, after) : sameIdentity(stat, after),
      'unsafe_input'
    );
  }
  check?.();
  requireCheck((await io.realpath(input.file)) === input.file, 'unsafe_input');
  check?.();
}

/**
 * Bounded no-follow read; optional scenario checkpoints stop subsequent I/O on
 * cancellation. An already-open descriptor is closed when its pending call settles.
 */
async function read(file, io, limit, check) {
  const input = await pin(file, io, limit, check);
  check?.();
  const handle = await io.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  let bytes;
  let error;
  try {
    check?.();
    requireCheck(unchanged(input.stat, await handle.stat({ bigint: true })), 'unsafe_input');
    check?.();
    bytes = Buffer.alloc(Number(input.stat.size));
    let offset = 0;
    while (offset < bytes.length) {
      check?.();
      const next = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), null);
      check?.();
      if (!next.bytesRead) break;
      offset += next.bytesRead;
    }
    check?.();
    const extra = await handle.read(Buffer.alloc(1), 0, 1, null);
    check?.();
    requireCheck(
      offset === bytes.length &&
        !extra.bytesRead &&
        unchanged(input.stat, await handle.stat({ bigint: true })),
      'unsafe_input'
    );
    check?.();
    await recheck(input, io, check);
  } catch (caught) {
    error = failure(caught, 'input_failed');
  }
  try {
    await handle.close();
  } catch (caught) {
    error = failure(caught, 'cleanup_failed');
  }
  if (error) throw error;
  return { input, bytes };
}

/** Only the builder's reviewed source and runtime dependency closure may be extracted. */
function allowed(name) {
  if (REQUIRED.has(name)) return true;
  const parts = name.split('/');
  if (parts[0] !== 'node_modules' || !DEPENDENCIES.has(parts[1])) return false;
  const local = parts.slice(2).join('/');
  return (
    local === 'package.json' ||
    DEPENDENCIES.get(parts[1]).some((item) =>
      item.endsWith('/')
        ? local.startsWith(item) &&
          /\.(js|json)$/.test(local) &&
          local.slice(item.length).split('/').length <= 17
        : local === item
    )
  );
}

/**
 * Accepts only the deterministic stored-file ZIP format produced by build:mcpb.
 * ZIP64, compression, comments, extra fields, special files and ambiguous names
 * fail before unzip. Local and central records must describe identical bytes.
 * Time O(B + N L²), space O(N L), excluding caller-owned bounded archive bytes.
 */
function inventory(bytes, check) {
  const files = new Map();
  const folders = new Set();
  const names = new Set();
  requireCheck(bytes.length >= 22, 'archive_invalid');
  const end = bytes.length - 22;
  requireCheck(
    bytes.readUInt32LE(end) === 0x06054b50 &&
      bytes.readUInt32LE(end + 4) === 0 &&
      bytes.readUInt16LE(end + 20) === 0,
    'archive_invalid'
  );
  const count = bytes.readUInt16LE(end + 10);
  requireCheck(
    count > 0 && count <= MAX_ENTRIES && bytes.readUInt16LE(end + 8) === count,
    'size_limit'
  );
  const start = bytes.readUInt32LE(end + 16);
  requireCheck(start + bytes.readUInt32LE(end + 12) === end, 'archive_invalid');
  let cursor = start;
  let local = 0;
  let total = 0;
  let nameBytes = 0;
  for (let i = 0; i < count; i++) {
    check?.();
    requireCheck(
      cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50,
      'archive_invalid'
    );
    const size = bytes.readUInt32LE(cursor + 24);
    const length = bytes.readUInt16LE(cursor + 28);
    requireCheck(length > 0 && length <= MAX_NAME && cursor + 46 + length <= end, 'size_limit');
    nameBytes += length;
    total += size;
    requireCheck(
      nameBytes <= MAX_ENTRIES * MAX_NAME && total <= 256 * MIB && size <= 128 * MIB,
      'size_limit'
    );
    const raw = bytes.subarray(cursor + 46, cursor + 46 + length);
    const name = raw.toString('utf8');
    const key = name.normalize('NFC').toLowerCase();
    requireCheck(
      Buffer.from(name).equals(raw) &&
        !name
          .split('/')
          .some(
            (part) =>
              !part ||
              part === '.' ||
              part === '..' ||
              /[\\:*?"<>|\p{Cc}]/u.test(part) ||
              /[. ]$/.test(part)
          ),
      'archive_invalid'
    );
    requireCheck(!names.has(key) && !folders.has(key) && allowed(name), 'archive_invalid');
    for (let slash = key.indexOf('/'); slash !== -1; slash = key.indexOf('/', slash + 1)) {
      const parent = key.slice(0, slash);
      requireCheck(!names.has(parent), 'archive_invalid');
      folders.add(parent);
    }
    names.add(key);
    requireCheck(
      bytes.readUInt16LE(cursor + 4) === 0x0314 &&
        bytes.readUInt16LE(cursor + 6) === 20 &&
        bytes.readUInt16LE(cursor + 8) === 0x0800 &&
        bytes.readUInt16LE(cursor + 10) === 0 &&
        bytes.readUInt32LE(cursor + 20) === size &&
        bytes.readUInt32LE(cursor + 30) === 0 &&
        bytes.readUInt32LE(cursor + 34) === 0 &&
        bytes.readUInt32LE(cursor + 38) === (0o100644 << 16) >>> 0 &&
        bytes.readUInt32LE(cursor + 42) === local,
      'archive_invalid'
    );
    requireCheck(
      local + 30 + length + size <= start &&
        bytes.readUInt32LE(local) === 0x04034b50 &&
        bytes.readUInt16LE(local + 4) === 20 &&
        bytes.readUInt16LE(local + 6) === 0x0800 &&
        bytes.readUInt16LE(local + 8) === 0 &&
        bytes.readUInt32LE(local + 14) === bytes.readUInt32LE(cursor + 16) &&
        bytes.readUInt32LE(local + 18) === size &&
        bytes.readUInt32LE(local + 22) === size &&
        bytes.readUInt16LE(local + 26) === length &&
        bytes.readUInt16LE(local + 28) === 0 &&
        bytes.subarray(local + 30, local + 30 + length).equals(raw),
      'archive_invalid'
    );
    const data = bytes.subarray(local + 30 + length, local + 30 + length + size);
    files.set(name, { size, sha256: digest(data) });
    local += 30 + length + size;
    cursor += 46 + length;
  }
  requireCheck(
    cursor === end && local === start && [...REQUIRED].every((name) => files.has(name)),
    'archive_invalid'
  );
  check?.();
  return files;
}

/** Verifies the entire extracted tree against the inspected snapshot, including empty extras. */
async function validateExtraction(root, files, io, budget) {
  const directories = new Set();
  for (const name of files.keys()) {
    for (let slash = name.indexOf('/'); slash !== -1; slash = name.indexOf('/', slash + 1))
      directories.add(name.slice(0, slash));
  }
  let seen = 0;
  async function visit(relative) {
    const directory = await budget.run(() => io.opendir(path.join(root, relative)));
    try {
      for (;;) {
        const entry = await budget.run(() => directory.read());
        if (entry === null) break;
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        requireCheck(
          ++seen <= MAX_ENTRIES * 32 && Buffer.byteLength(name) <= MAX_NAME,
          'size_limit'
        );
        const stat = await budget.run(() => io.lstat(path.join(root, name)));
        requireCheck(!stat.isSymbolicLink(), 'unsafe_input');
        if (stat.isDirectory()) {
          requireCheck(directories.has(name), 'archive_invalid');
          await visit(name);
        } else {
          const expected = files.get(name);
          requireCheck(expected && stat.isFile(), 'archive_invalid');
          const { bytes } = await budget.run(() =>
            read(path.join(root, name), io, expected.size, budget.check)
          );
          requireCheck(
            bytes.length === expected.size && digest(bytes) === expected.sha256,
            'archive_invalid'
          );
        }
      }
    } finally {
      // Closing belongs to the same total budget. Promise.race retains ownership
      // of a late close rejection even though kernel descriptor cleanup cannot be
      // forcibly cancelled when the host does not schedule completion in time.
      await budget.run(() => directory.close());
    }
  }
  await visit('');
  // The explicit read also detects an omitted expected file, even in an empty tree.
  for (const [name, expected] of files) {
    budget.check();
    const stat = await budget.run(() => io.lstat(path.join(root, name)));
    requireCheck(
      stat.isFile() && !stat.isSymbolicLink() && stat.size === expected.size,
      'archive_invalid'
    );
  }
}
async function validateBundle(root, io, files, arch, budget) {
  await validateExtraction(root, files, io, budget);
  const manifest = decode(
    (await budget.run(() => read(path.join(root, 'manifest.json'), io, MIB, budget.check))).bytes,
    'archive_invalid'
  );
  const config = manifest?.server?.mcp_config;
  requireCheck(
    manifest?.manifest_version === '0.3' &&
      manifest.name === 'krypton-protected-fs' &&
      manifest.server.type === 'node' &&
      manifest.server.entry_point === 'src/packaging/launch_mcpb.cjs' &&
      config?.command === 'node' &&
      JSON.stringify(config.args) === '["${__dirname}/src/packaging/launch_mcpb.cjs"]' &&
      object(config.env) &&
      Object.keys(config.env).length === 1 &&
      config.env.KRYPTON_PROTECTED_WORKSPACE_ROOT === '${user_config.protected_workspace_root}' &&
      manifest.user_config?.protected_workspace_root?.required === false &&
      manifest.user_config?.protected_workspace_root?.type === 'directory' &&
      !('project_root' in manifest.user_config),
    'archive_invalid'
  );
  const metadata = decode(
    (
      await budget.run(() =>
        read(path.join(root, 'native/native-binaries.json'), io, MIB, budget.check)
      )
    ).bytes,
    'archive_invalid'
  );
  requireCheck(
    metadata?.schemaVersion === 1 &&
      object(metadata.binaries) &&
      Object.keys(metadata.binaries).length === 2,
    'archive_invalid'
  );
  for (const [architecture, [name, cpu]] of Object.entries(NATIVE)) {
    const item = metadata.binaries[architecture];
    const expected = files.get(name);
    requireCheck(
      item?.path === name && item.size === expected.size && item.sha256 === expected.sha256,
      'archive_invalid'
    );
    if (architecture === arch) {
      const { bytes } = await budget.run(() =>
        read(path.join(root, name), io, 128 * MIB, budget.check)
      );
      requireCheck(
        bytes.length >= 32 &&
          bytes.readUInt32LE(0) === 0xfeedfacf &&
          bytes.readUInt32LE(4) === cpu &&
          bytes.readUInt32LE(12) === 2,
        'archive_invalid'
      );
    }
  }
  return path.join(root, manifest.server.entry_point);
}

/** Owns all child errors/output immediately; retains at most one bounded protocol frame. */
function observe(child, protocol) {
  const state = {
    child,
    closed: false,
    error: undefined,
    code: null,
    signal: null,
    ending: false,
    bytes: 0,
    stderr: 0,
    frames: 0,
    frame: Buffer.alloc(0),
    sent: 0,
    seen: new Set(),
    pending: null,
    response: undefined,
  };
  function reset() {
    state.changed = new Promise((resolve) => {
      state.wake = resolve;
    });
  }
  reset();
  state.poke = () => {
    state.wake();
    reset();
  };
  state.fail = (code) => {
    state.error ??= new PackagedE2EError(code);
    state.poke();
  };
  state.check = () => {
    if (state.error) throw state.error;
  };
  child.on('error', () => state.fail('child_failed'));
  child.once('close', (code, signal) => {
    state.closed = true;
    state.code = code;
    state.signal = signal;
    if (protocol && (!state.ending || state.pending !== null || state.frame.length))
      state.fail('protocol_failed');
    state.poke();
  });
  requireCheck(child.stdout && child.stderr && child.stdin, 'child_failed');
  for (const stream of [child.stdin, child.stdout, child.stderr])
    stream.on('error', () => state.fail('child_failed'));
  child.stderr.on('data', (chunk) => {
    state.stderr += Buffer.byteLength(chunk);
    if (state.stderr > OUTPUT_BYTES) state.fail('output_limit');
  });
  child.stdout.on('data', (chunk) => {
    if (state.error) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    state.bytes += bytes.length;
    if (state.bytes > (protocol ? FRAME_BYTES * 32 : OUTPUT_BYTES))
      return state.fail('output_limit');
    if (!protocol) return;
    let offset = 0;
    while (offset < bytes.length && !state.error) {
      const newline = bytes.indexOf(10, offset);
      const end = newline === -1 ? bytes.length : newline;
      if (state.frame.length + end - offset > FRAME_BYTES) return state.fail('output_limit');
      state.frame = Buffer.concat([state.frame, bytes.subarray(offset, end)]);
      offset = end + 1;
      if (newline === -1) break;
      try {
        requireCheck(++state.frames <= 32, 'output_limit');
        const reply = decode(state.frame, 'protocol_failed');
        state.frame = Buffer.alloc(0);
        requireCheck(
          object(reply) &&
            reply.jsonrpc === '2.0' &&
            Number.isSafeInteger(reply.id) &&
            reply.id === state.pending &&
            !state.seen.has(reply.id) &&
            object(reply.result) &&
            !('error' in reply),
          'protocol_failed'
        );
        state.seen.add(reply.id);
        state.pending = null;
        state.response = reply.result;
        state.poke();
      } catch (error) {
        state.error = failure(error, 'protocol_failed');
        state.poke();
      }
    }
  });
  return state;
}

/** One absolute timer owns each wait; bytes and events cannot extend its budget. */
async function until(state, predicate, milliseconds, code, ctx, check = true) {
  let timer;
  let expired = false;
  const timeout = new Promise((resolve) => {
    timer = ctx.setTimer(() => {
      expired = true;
      resolve();
    }, milliseconds);
  });
  try {
    for (;;) {
      if (check) state.check();
      if (predicate()) return;
      requireCheck(!expired, code);
      await Promise.race([state.changed, timeout]);
    }
  } finally {
    ctx.clearTimer(timer);
  }
}
async function cleanupChild(state, ctx) {
  if (state.closed) return;
  let cleanupError;
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    try {
      requireCheck(state.child.kill(signal), 'cleanup_failed');
    } catch (error) {
      cleanupError = failure(error, 'cleanup_failed');
    }
    try {
      await until(state, () => state.closed, 2000, 'cleanup_failed', ctx, false);
    } catch (error) {
      cleanupError = failure(error, 'cleanup_failed');
    }
    if (state.closed) return;
  }
  throw cleanupError ?? new PackagedE2EError('cleanup_failed');
}
async function extract(snapshot, destination, ctx, budget) {
  const child = ctx.spawn('/usr/bin/unzip', ['-q', snapshot, '-d', destination], {
    shell: false,
    cwd: destination,
    env: { PATH: '/usr/bin:/bin' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = observe(child, false);
  try {
    child.stdin.end();
    await budget.run(() => until(state, () => state.closed, 10000, 'extraction_timeout', ctx));
    requireCheck(state.code === 0 && state.signal === null, 'extraction_failed');
  } finally {
    await cleanupChild(state, ctx);
  }
}
function write(state, message) {
  state.check();
  requireCheck(!state.closed && !state.ending, 'protocol_failed');
  try {
    state.child.stdin.write(JSON.stringify(message) + '\n', (error) => {
      if (error) state.fail('child_failed');
    });
  } catch (error) {
    throw failure(error, 'child_failed');
  }
}
async function request(state, method, params, ctx) {
  state.check();
  requireCheck(state.pending === null, 'protocol_failed');
  state.response = undefined;
  state.pending = ++state.sent;
  write(state, { jsonrpc: '2.0', id: state.pending, method, params });
  await until(state, () => state.response !== undefined, SCENARIO_MS, 'scenario_timeout', ctx);
  state.check();
  return state.response;
}
function textResult(result, isError) {
  requireCheck(
    result.isError === isError &&
      Array.isArray(result.content) &&
      result.content.length === 1 &&
      result.content[0]?.type === 'text' &&
      typeof result.content[0].text === 'string',
    'scenario_failed'
  );
  return result.content[0].text;
}
function denial(result) {
  const evidence = decode(Buffer.from(textResult(result, true)), 'receipt_invalid');
  const receipt = evidence?.receipt;
  requireCheck(
    evidence?.code === 'file_access_denied' &&
      object(receipt) &&
      receipt.tool === 'krypton_read_file' &&
      receipt.path === '../outside.txt' &&
      receipt.action === 'denied' &&
      receipt.telemetry === 'queued' &&
      typeof receipt.id === 'string' &&
      /^native-mcp-[a-zA-Z0-9-]{1,128}$/.test(receipt.id) &&
      typeof receipt.capturedAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.capturedAt) &&
      Number.isFinite(Date.parse(receipt.capturedAt)),
    'receipt_invalid'
  );
  return receipt;
}
async function socketAccepts(file, ctx, signal) {
  return new Promise((resolve, reject) => {
    let socket;
    let timer;
    let settled = false;
    const finish = (error, connected) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      ctx.clearTimer(timer);
      socket?.destroy();
      if (error) reject(error);
      else resolve(connected);
    };
    const abort = () => finish(signal.reason);
    try {
      if (signal?.aborted) {
        abort();
        return;
      }
      socket = ctx.connect(file);
      socket.once('connect', () => finish(undefined, true));
      socket.on('error', (error) => {
        if (error && ['ENOENT', 'ECONNREFUSED'].includes(error.code)) finish(undefined, false);
        else finish(new PackagedE2EError('socket_failed'));
      });
      timer = ctx.setTimer(() => finish(new PackagedE2EError('socket_failed')), 1500);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    } catch (error) {
      finish(failure(error, 'socket_failed'));
    }
  });
}
/** Telemetry gets one two-second budget, including read/close, parsing and polling. */
async function durableReceipt(file, receipt, ctx, scenarioBudget) {
  const budget = operationDeadline(ctx, 2000, 'telemetry_invalid', { parent: scenarioBudget });
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      budget.check();
      let bytes;
      try {
        bytes = (await budget.run(() => read(file, ctx.fs, 8 * MIB, budget.check))).bytes;
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
      }
      budget.check();
      if (bytes?.length) {
        requireCheck(bytes[bytes.length - 1] === 10, 'telemetry_invalid');
        const lines = bytes.toString('utf8').split('\n');
        lines.pop();
        requireCheck(lines.length <= 10000, 'telemetry_invalid');
        let found = false;
        for (const line of lines) {
          budget.check();
          requireCheck(Buffer.byteLength(line) <= FRAME_BYTES, 'telemetry_invalid');
          const row = decode(Buffer.from(line), 'telemetry_invalid');
          budget.check();
          requireCheck(
            object(row) &&
              Number.isSafeInteger(row.sequence) &&
              row.sequence > 0 &&
              row.source === 'native',
            'telemetry_invalid'
          );
          if (row.id !== receipt.id) continue;
          requireCheck(
            !found &&
              row.capturedAt === receipt.capturedAt &&
              row.category === 'mcp_boundary' &&
              row.severity === 'high' &&
              row.path === receipt.path &&
              row.attribution === 'unattributed' &&
              row.process === undefined &&
              row.details?.tool === receipt.tool &&
              row.details?.action === receipt.action,
            'telemetry_invalid'
          );
          found = true;
        }
        budget.check();
        if (found) return;
      }
      await budget.run(
        () =>
          new Promise((resolve) => {
            const finish = () => {
              ctx.clearTimer(timer);
              budget.signal.removeEventListener('abort', finish);
              resolve();
            };
            const timer = ctx.setTimer(
              finish,
              Math.min(50, Math.max(0, budget.deadlineAt - ctx.now()))
            );
            budget.signal.addEventListener('abort', finish, { once: true });
            if (budget.signal.aborted) finish();
          })
      );
    }
    throw new PackagedE2EError('telemetry_invalid');
  } finally {
    budget.stop();
  }
}

/**
 * One absolute budget races every await, retains late rejection handlers, and
 * prevents subsequent work. Child budgets cannot exceed their parent's remaining
 * time and follow its cancellation. In-flight kernel I/O is not forcibly cancelled;
 * read checkpoints permit only descriptor cleanup when such a call later settles.
 */
function operationDeadline(ctx, milliseconds, code, options = {}) {
  const controller = new AbortController();
  const startedAt = ctx.now();
  const duration = Math.min(
    milliseconds,
    Math.max(0, (options.parent?.deadlineAt ?? Infinity) - startedAt)
  );
  const deadlineAt = startedAt + duration;
  const cancelled = new Promise((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(controller.signal.reason), {
      once: true,
    });
  });
  const parentAborted = () => controller.abort(options.parent.signal.reason);
  const expire = () => {
    try {
      options.parent?.check();
    } catch (error) {
      controller.abort(failure(error, code));
      return;
    }
    controller.abort(options.expire?.() ?? new PackagedE2EError(code));
  };
  const timer = ctx.setTimer(expire, duration);
  options.parent?.signal.addEventListener('abort', parentAborted, { once: true });
  if (options.parent?.signal.aborted) parentAborted();
  const check = () => {
    options.parent?.check();
    if (!controller.signal.aborted && ctx.now() >= deadlineAt) expire();
    options.check?.();
    controller.signal.throwIfAborted();
  };
  return {
    check,
    deadlineAt,
    signal: controller.signal,
    async run(operation) {
      check();
      const result = await Promise.race([
        Promise.resolve().then(() => {
          check();
          return operation();
        }),
        cancelled.then((error) => {
          throw error;
        }),
      ]);
      check();
      return result;
    },
    stop() {
      ctx.clearTimer(timer);
      options.parent?.signal.removeEventListener('abort', parentAborted);
      controller.abort(new PackagedE2EError(code));
    },
  };
}

/** Scenario expiry also wakes protocol waits and preserves the first latched failure. */
function scenarioDeadline(state, ctx, parent) {
  return operationDeadline(ctx, SCENARIO_MS, 'scenario_timeout', {
    parent,
    check: state.check,
    expire: () => {
      state.fail('scenario_timeout');
      return state.error;
    },
  });
}

/** Each scenario drives only the extracted launcher and private fixture files. */
async function scenario(paths, launcher, fallback, ctx, parent) {
  const support = path.join(paths.home, 'Library/Application Support/KryptonSecurity');
  const workspace = fallback ? path.join(support, 'sandbox_workspace') : paths.workspace;
  const env = {
    HOME: paths.home,
    TMPDIR: paths.temp,
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    KRYPTON_PROTECTED_WORKSPACE_ROOT: fallback ? '' : workspace,
  };
  const child = ctx.spawn(process.execPath, [launcher], {
    cwd: paths.cwd,
    env,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = observe(child, true);
  const deadline = scenarioDeadline(state, ctx, parent);
  let socket;
  try {
    const initialized = await deadline.run(() =>
      request(
        state,
        'initialize',
        {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'krypton-packaged-e2e', version: '1.0.0' },
        },
        ctx
      )
    );
    requireCheck(
      initialized.protocolVersion === '2025-11-25' &&
        initialized.serverInfo?.name === 'krypton-protected-fs' &&
        object(initialized.capabilities?.tools),
      'protocol_failed'
    );
    deadline.check();
    write(state, { jsonrpc: '2.0', method: 'notifications/initialized' });
    const stat = await deadline.run(() => ctx.fs.lstat(workspace));
    requireCheck(
      stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        (await deadline.run(() => ctx.fs.realpath(workspace))) === workspace &&
        (!fallback || (stat.mode & 0o077) === 0),
      'scenario_failed'
    );
    if (fallback)
      await deadline.run(() =>
        ctx.fs.writeFile(path.join(workspace, 'inside.txt'), 'packaged UTF-8 fixture: café\n', {
          flag: 'wx',
          mode: 0o600,
        })
      );
    const readResult = await deadline.run(() =>
      request(
        state,
        'tools/call',
        { name: 'krypton_read_file', arguments: { path: 'inside.txt' } },
        ctx
      )
    );
    requireCheck(
      textResult(readResult, false) === 'packaged UTF-8 fixture: café\n',
      'scenario_failed'
    );
    const workspaceId = createHash('sha256').update(workspace).digest('hex');
    const instance = path.join(support, 'instances', workspaceId);
    const config = decode(
      (
        await deadline.run(() =>
          read(path.join(instance, 'config/runtime.json'), ctx.fs, 65536, deadline.check)
        )
      ).bytes,
      'scenario_failed'
    );
    const telemetry = path.join(instance, '.krypton/telemetry/alerts.jsonl');
    requireCheck(
      config?.schemaVersion === 1 &&
        config.protectedWorkspaceRoot === workspace &&
        config.telemetryPath === telemetry &&
        typeof config.runtimeDirectory === 'string' &&
        config.runtimeDirectory.startsWith(paths.temp + path.sep) &&
        path.resolve(config.runtimeDirectory) === config.runtimeDirectory,
      'scenario_failed'
    );
    socket = path.join(config.runtimeDirectory, 'daemon.sock');
    requireCheck(
      await deadline.run(() => socketAccepts(socket, ctx, deadline.signal)),
      'socket_failed'
    );
    if (!fallback) {
      const receipt = denial(
        await deadline.run(() =>
          request(
            state,
            'tools/call',
            { name: 'krypton_read_file', arguments: { path: '../outside.txt' } },
            ctx
          )
        )
      );
      await deadline.run(() => durableReceipt(telemetry, receipt, ctx, deadline));
    }
    deadline.check();
    state.ending = true;
    child.stdin.end();
    await deadline.run(() => until(state, () => state.closed, 6000, 'cleanup_failed', ctx));
    requireCheck(
      state.code === 0 &&
        state.signal === null &&
        state.seen.size === state.sent &&
        state.frame.length === 0,
      'protocol_failed'
    );
    requireCheck(
      !(await deadline.run(() => socketAccepts(socket, ctx, deadline.signal))),
      'cleanup_failed'
    );
    // A late probe result must never override a latched error or expired budget.
    deadline.check();
    state.check();
  } finally {
    deadline.stop();
    if (!state.closed) {
      // Cleanup has its own bounded budget; expired scenario work cannot resume.
      state.ending = true;
      try {
        child.stdin.end();
        await until(state, () => state.closed, 6000, 'cleanup_failed', ctx, false);
      } catch (error) {
        if (!(error instanceof PackagedE2EError)) state.fail('cleanup_failed');
      }
      await cleanupChild(state, ctx);
    }
  }
}

/**
 * One cleanup budget covers a late mkdtemp result, identity validation and removal
 * of the exact owned tree. A rejected creation owns no path and is only observed.
 * A cleanup timeout reports uncertainty and is never retried: a kernel call that
 * remains stalled beyond this budget cannot be cancelled or safely acted on later.
 * Losing calls retain rejection ownership through the budget race.
 */
async function removeOwned(owned, ownedStat, creation, parent, ctx) {
  const budget = operationDeadline(ctx, 6000, 'cleanup_failed');
  try {
    let candidate = owned;
    if (!candidate && creation) {
      try {
        candidate = await budget.run(() => creation);
      } catch (error) {
        // If the cleanup budget expired, check rethrows cleanup_failed. A settled
        // creation rejection proves there is no returned path to authorize.
        budget.check();
        void error;
        return;
      }
    }
    if (!candidate) return;
    requireCheck(
      typeof parent === 'string' &&
        typeof candidate === 'string' &&
        path.isAbsolute(candidate) &&
        path.resolve(candidate) === candidate &&
        path.dirname(candidate) === parent &&
        /^km-[^/]+$/.test(path.basename(candidate)),
      'cleanup_failed'
    );
    const initial =
      ownedStat ?? (await budget.run(() => ctx.fs.lstat(candidate, { bigint: true })));
    requireCheck(
      initial.isDirectory() && !initial.isSymbolicLink() && (initial.mode & 0o077n) === 0n,
      'cleanup_failed'
    );
    const current = await budget.run(() => ctx.fs.lstat(candidate, { bigint: true }));
    requireCheck(sameIdentity(initial, current), 'cleanup_failed');
    requireCheck(
      (await budget.run(() => ctx.fs.realpath(candidate))) === candidate,
      'cleanup_failed'
    );
    await budget.run(() => ctx.fs.rm(candidate, { recursive: true, force: false, maxRetries: 0 }));
    budget.check();
  } finally {
    budget.stop();
  }
}

/**
 * Rehearses one finished bundle without using checkout runtime modules after spawn.
 * Bounds archive/payload bytes, inventory, extraction, MCP frames, scenarios and cleanup.
 * Kernel filesystem/scheduler stalls are not hard real-time guarantees; no timed-out
 * writes are retried. Only the exact mkdtemp-owned tree is recursively removed.
 * @param {string} bundlePath Completed deterministic .mcpb archive.
 * @param {import('./mcpb_e2e.cjs').PackagedE2EDependencies} dependencies Injected host boundaries.
 * @returns {Promise<void>} Resolves after both scenarios, child exit and tree cleanup.
 * @complexity O(B + N L²) archive validation, bounded filesystem/protocol work thereafter.
 * @example await runPackagedMcpbE2E('dist/krypton-protected-fs.mcpb');
 */
async function runPackagedMcpbE2E(bundlePath, dependencies = {}) {
  const ctx = {
    fs: { ...fs, ...dependencies.fs },
    spawn,
    connect: (file) => net.createConnection(file),
    now: () => performance.now(),
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    report: console.log,
    platform: process.platform,
    arch: process.arch,
    temporaryDirectory: '/private/tmp',
    ...dependencies,
  };
  ctx.fs = { ...fs, ...dependencies.fs };
  let owned;
  let ownedStat;
  let ownedCreation;
  let ownedParent;
  let error;
  let total;
  try {
    total = operationDeadline(ctx, TOTAL_RUN_MS, 'operation_timeout');
    total.check();
    requireCheck(
      ctx.platform === 'darwin' && Object.hasOwn(NATIVE, ctx.arch),
      'unsupported_platform'
    );
    requireCheck(
      typeof bundlePath === 'string' &&
        bundlePath.endsWith('.mcpb') &&
        Buffer.byteLength(bundlePath) <= 4096 &&
        !bundlePath.includes('\0') &&
        !bundlePath.split('/').includes('..'),
      'input_failed'
    );
    const original = await total.run(() =>
      read(path.resolve(bundlePath), ctx.fs, MAX_ARCHIVE, total.check)
    );
    const files = inventory(original.bytes, total.check);
    ownedParent = await total.run(() => ctx.fs.realpath(ctx.temporaryDirectory));
    ownedCreation = Promise.resolve().then(() => ctx.fs.mkdtemp(path.join(ownedParent, 'km-')));
    owned = await total.run(() => ownedCreation);
    requireCheck(
      typeof owned === 'string' &&
        path.isAbsolute(owned) &&
        path.resolve(owned) === owned &&
        path.dirname(owned) === ownedParent &&
        /^km-[^/]+$/.test(path.basename(owned)),
      'unsafe_input'
    );
    ownedStat = await total.run(() => ctx.fs.lstat(owned, { bigint: true }));
    requireCheck(
      ownedStat.isDirectory() && !ownedStat.isSymbolicLink() && (ownedStat.mode & 0o077n) === 0n,
      'unsafe_input'
    );
    const paths = {
      home: path.join(owned, 'home'),
      bundle: path.join(owned, 'bundle'),
      workspace: path.join(owned, 'protected'),
      cwd: path.join(owned, 'cwd'),
      temp: path.join(owned, 't'),
    };
    for (const directory of Object.values(paths))
      await total.run(() => ctx.fs.mkdir(directory, { mode: 0o700 }));
    for (const directory of [paths.home, paths.cwd])
      requireCheck((await total.run(() => ctx.fs.readdir(directory))).length === 0, 'unsafe_input');
    await total.run(() =>
      ctx.fs.writeFile(path.join(paths.workspace, 'inside.txt'), 'packaged UTF-8 fixture: café\n', {
        flag: 'wx',
        mode: 0o600,
      })
    );
    await total.run(() =>
      ctx.fs.writeFile(path.join(owned, 'outside.txt'), 'outside fixture must never be returned', {
        flag: 'wx',
        mode: 0o600,
      })
    );
    const snapshot = path.join(owned, 'input.mcpb');
    await total.run(() => ctx.fs.writeFile(snapshot, original.bytes, { flag: 'wx', mode: 0o600 }));
    const snapshotPin = await total.run(() => pin(snapshot, ctx.fs, MAX_ARCHIVE, total.check));
    await total.run(() => recheck(original.input, ctx.fs, total.check));
    await extract(snapshot, paths.bundle, ctx, total);
    total.check();
    await total.run(() => recheck(snapshotPin, ctx.fs, total.check));
    await total.run(() => recheck(original.input, ctx.fs, total.check));
    const launcher = await validateBundle(paths.bundle, ctx.fs, files, ctx.arch, total);
    await scenario(paths, launcher, false, ctx, total);
    await scenario(paths, launcher, true, ctx, total);
  } catch (caught) {
    error = failure(caught, 'operation_failed');
  } finally {
    total?.stop();
  }
  if (owned || ownedCreation) {
    try {
      await removeOwned(owned, ownedStat, ownedCreation, ownedParent, ctx);
    } catch (caught) {
      error = failure(caught, 'cleanup_failed');
      if (error.code !== 'cleanup_failed') error = new PackagedE2EError('cleanup_failed');
    }
  }
  if (error) throw error;
  for (const check of PASSES) ctx.report(`[PASS] ${check}.`);
}

if (require.main === module)
  void runCli(async (argv) => {
    if (argv.length !== 1) return 2;
    await runPackagedMcpbE2E(argv[0]);
    return 0;
  });
module.exports = { runPackagedMcpbE2E, PackagedE2EError };

#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { runCli } = require('../cli/runtime.cjs');
const { createZip } = require('./zip.cjs');

const SOURCE_FILES = [
  'LICENSE',
  'src/cli/runtime.cjs',
  'src/core/processIsolation.cjs',
  'src/core/mcp/server.cjs',
  'src/packaging/launch_mcpb.cjs',
  'src/packaging/mcpb_runtime.cjs',
];
// Explicit runtime roots prevent new package layouts from silently shipping tests,
// credentials or development tooling. Dependency upgrades must review this map.
const RUNTIME_FILES = new Map([
  ['ajv', ['dist/', 'LICENSE']],
  ['fast-deep-equal', ['index.js', 'LICENSE']],
  ['fast-uri', ['index.js', 'lib/', 'LICENSE']],
  ['json-schema-traverse', ['index.js', 'LICENSE']],
  ['require-from-string', ['index.js', 'license']],
]);
const MAX_FILE = 1024 * 1024;
const MAX_NATIVE = 128 * 1024 * 1024;
const MAX_TOTAL = 256 * 1024 * 1024;
const MAX_VERSION = 128;
const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const NATIVE = {
  arm64: { path: 'native/krypton-core-native-aarch64-apple-darwin', cpu: 0x0100000c },
  x64: { path: 'native/krypton-core-native-x86_64-apple-darwin', cpu: 0x01000007 },
};

/** A stable build failure; raw filesystem paths and exception details stay private. */
class PackagingError extends Error {
  /**
   * @param {import('./build_mcpb.cjs').PackagingErrorCode} code - Safe failure category.
   * @param {unknown} cause - Internal cause, never printed by the CLI.
   */
  constructor(code, cause) {
    super(code, { cause });
    this.name = 'PackagingError';
    this.code = code;
  }
}

/**
 * Produces MCPB 0.3 metadata with installation-time paths, never builder paths.
 * @param {string} version - Package semantic version.
 * @returns {object} Manifest accepted by the official MCPB manifest schema.
 */
function createManifest(version) {
  if (
    typeof version !== 'string' ||
    version.length > MAX_VERSION ||
    !/^[\x21-\x7e]+$/.test(version) ||
    !SEMVER.test(version)
  )
    throw new PackagingError('input_invalid');
  return {
    manifest_version: '0.3',
    name: 'krypton-protected-fs',
    display_name: 'Krypton Protected Filesystem',
    version,
    description: 'Deterministic, native-enforced filesystem containment engine for AI agents.',
    author: { name: 'Krypton contributors', url: 'https://github.com/mwarnsley/krypton-security' },
    license: 'ISC',
    server: {
      type: 'node',
      entry_point: 'src/packaging/launch_mcpb.cjs',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/src/packaging/launch_mcpb.cjs'],
        env: { KRYPTON_PROTECTED_WORKSPACE_ROOT: '${user_config.protected_workspace_root}' },
      },
    },
    tools: [
      {
        name: 'krypton_read_file',
        description: 'Read a protected file through the local native daemon.',
      },
      {
        name: 'krypton_write_file',
        description: 'Atomically write a protected file through the local native daemon.',
      },
    ],
    tools_generated: false,
    compatibility: { platforms: ['darwin'], runtimes: { node: '>=20.19.4' } },
    user_config: {
      protected_workspace_root: {
        type: 'directory',
        title: 'Protected workspace directory',
        description:
          'Select an existing directory to protect, or leave blank to use ~/Library/Application Support/KryptonSecurity/sandbox_workspace.',
        required: false,
      },
    },
  };
}

/** Rejects redirected source components before reading an allowlisted file. */
async function checkedPath(root, relative) {
  let current = root;
  for (const component of relative.split('/')) {
    if (!component || component === '.' || component === '..' || component.includes('\\'))
      throw new PackagingError('unsafe_input');
    current = path.join(current, component);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new PackagingError('unsafe_input');
  }
  return current;
}

/** Reads at most one MiB from a regular, non-symlink file; closes on every outcome. */
async function readInput(root, relative) {
  const file = await checkedPath(root, relative);
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new PackagingError('unsafe_input');
    if (stat.size > MAX_FILE) throw new PackagingError('size_limit');
    const buffer = Buffer.alloc(MAX_FILE + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_FILE) throw new PackagingError('size_limit');
    return Buffer.from(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
}

/** Compares pinned file/directory identity without relying on mutable parent timestamps. */
function sameIdentity(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.uid === after.uid &&
    before.gid === after.gid
  );
}

/** Detects replacement, size/content mutation or changed link count across a native read. */
function unchanged(before, after) {
  return (
    sameIdentity(before, after) &&
    before.size === after.size &&
    before.nlink === after.nlink &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}

/** Resolves bounded explicit inputs relative to the checkout; traversal is never normalized away. */
function nativePath(root, input) {
  if (
    typeof input !== 'string' ||
    !input ||
    input.includes('\0') ||
    input.includes('\\') ||
    input.length > 4096 ||
    Buffer.byteLength(input) > 4096 ||
    Buffer.from(input).toString() !== input ||
    input.split('/').includes('..')
  )
    throw new PackagingError('input_invalid');
  const resolved = path.resolve(root, input);
  if (Buffer.byteLength(resolved) > 4096) throw new PackagingError('input_invalid');
  return resolved;
}

/** Pins every native path component, rejecting symlink ancestors and non-regular leaves. */
async function inspectNative(file) {
  const pins = new Map();
  let current = path.parse(file).root;
  for (const component of file.slice(current.length).split(path.sep)) {
    current = path.join(current, component);
    const stat = await fs.lstat(current, { bigint: true });
    if (stat.isSymbolicLink() || (current === file ? !stat.isFile() : !stat.isDirectory()))
      throw new PackagingError('unsafe_input');
    pins.set(current, stat);
  }
  if ((await fs.realpath(file)) !== file) throw new PackagingError('unsafe_input');
  const stat = pins.get(file);
  if (stat.size > BigInt(MAX_NATIVE)) throw new PackagingError('size_limit');
  if (!stat.size) throw new PackagingError('invalid_binary');
  return { file, pins, stat };
}

/** Rechecks pinned ancestry and the leaf after I/O; metadata failures deny publication. */
async function recheckNative(input) {
  try {
    for (const [file, stat] of input.pins) {
      const current = await fs.lstat(file, { bigint: true });
      if (!(file === input.file ? unchanged(stat, current) : sameIdentity(stat, current)))
        throw new PackagingError('unsafe_input');
    }
    if ((await fs.realpath(input.file)) !== input.file) throw new PackagingError('unsafe_input');
  } catch (error) {
    if (error instanceof PackagingError) throw error;
    throw new PackagingError('unsafe_input', error);
  }
}

/**
 * Reads a pinned native file with no-follow/nonblocking open and at most 64 KiB per read.
 * The descriptor and complete path are revalidated before and after reading; no same-user
 * adversarial filesystem isolation is claimed. An extra byte detects growth at the limit.
 */
async function readNative(input, cpu) {
  await recheckNative(input);
  const handle = await fs.open(
    input.file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  let failure;
  let bytes;
  try {
    if (!unchanged(input.stat, await handle.stat({ bigint: true })))
      throw new PackagingError('unsafe_input');
    bytes = Buffer.alloc(Number(input.stat.size));
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        size,
        Math.min(65536, bytes.length - size),
        null
      );
      if (!bytesRead) break;
      size += bytesRead;
    }
    const extra = await handle.read(Buffer.alloc(1), 0, 1, null);
    if (
      size !== bytes.length ||
      extra.bytesRead ||
      !unchanged(input.stat, await handle.stat({ bigint: true }))
    )
      throw new PackagingError('unsafe_input');
    await recheckNative(input);
    if (
      bytes.length < 32 ||
      bytes.readUInt32LE(0) !== 0xfeedfacf ||
      bytes.readUInt32LE(4) !== cpu ||
      bytes.readUInt32LE(12) !== 2
    )
      throw new PackagingError('invalid_binary');
  } catch (error) {
    failure = error instanceof PackagingError ? error : new PackagingError('input_invalid', error);
  } finally {
    try {
      await handle.close();
    } catch (error) {
      failure = new PackagingError('cleanup_failed', error);
    }
  }
  if (failure) throw failure;
  return bytes;
}

/** Reads both reviewed architectures, rejecting duplicate paths or descriptor identities. */
async function collectNative(root, nativeInputs) {
  const inputs =
    nativeInputs === undefined
      ? {
          arm64: 'dist/' + NATIVE.arm64.path,
          x64: 'dist/' + NATIVE.x64.path,
        }
      : nativeInputs;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs))
    throw new PackagingError('input_invalid');
  const arm64 = await inspectNative(nativePath(root, inputs.arm64));
  const x64 = await inspectNative(nativePath(root, inputs.x64));
  if (arm64.stat.dev === x64.stat.dev && arm64.stat.ino === x64.stat.ino)
    throw new PackagingError('unsafe_input');
  const binaries = {};
  const entries = [];
  for (const [arch, input] of [
    ['arm64', arm64],
    ['x64', x64],
  ]) {
    const data = await readNative(input, NATIVE[arch].cpu);
    const name = NATIVE[arch].path;
    entries.push({ name, data });
    binaries[arch] = {
      path: name,
      size: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    };
  }
  // Detect changes to the first input while the second architecture was being read.
  await recheckNative(arm64);
  await recheckNative(x64);
  return { entries, metadata: { schemaVersion: 1, binaries } };
}

/** Collects only reviewed runtime sources and the lockfile-matched Ajv dependency closure. */
async function collectEntries(root, nativeInputs) {
  const pkg = JSON.parse(await readInput(root, 'package.json'));
  const lock = JSON.parse(await readInput(root, 'package-lock.json'));
  const manifest = createManifest(pkg.version);
  if (pkg.dependencies?.ajv !== lock.packages?.['']?.dependencies?.ajv)
    throw new PackagingError('dependency_invalid');
  const entries = [];
  let total = 0;
  let visited = 0;
  const add = (name, data) => {
    total += data.length;
    if (total > MAX_TOTAL || entries.length >= 2048) throw new PackagingError('size_limit');
    entries.push({ name, data });
  };
  const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const addFile = async (relative) => add(relative, await readInput(root, relative));
  const walk = async (relative, depth = 0) => {
    if (depth > 16) throw new PackagingError('size_limit');
    const directory = await fs.opendir(await checkedPath(root, relative));
    for await (const entry of directory) {
      if (++visited > 4096) throw new PackagingError('size_limit');
      const child = relative + '/' + entry.name;
      if (entry.isSymbolicLink()) throw new PackagingError('unsafe_input');
      if (entry.isDirectory()) await walk(child, depth + 1);
      else if (/\.(js|json)$/.test(entry.name)) await addFile(child);
    }
  };
  add('manifest.json', json(manifest));
  add(
    'package.json',
    json({
      name: manifest.name,
      version: pkg.version,
      private: true,
      type: 'commonjs',
      dependencies: { ajv: pkg.dependencies.ajv },
    })
  );
  add(
    'README.md',
    Buffer.from(
      '# Krypton Protected Filesystem\n\n' +
        'Select an existing protected workspace directory, or leave the selection blank to use\n' +
        '~/Library/Application Support/KryptonSecurity/sandbox_workspace. Invalid nonblank\n' +
        'selections fail closed. Exactly two Krypton file tools are contained:\n' +
        'krypton_read_file and krypton_write_file. This extension does not intercept Claude\n' +
        "Desktop's built-in tools. There is no bundled dashboard.\n\n" +
        'The matching bundled macOS arm64 or x64 daemon is selected and supervised automatically.\n' +
        'Installed use requires no checkout or Rust toolchain; the host supplies Node >=20.19.4.\n' +
        'Native telemetry persists beneath ~/Library/Application Support/KryptonSecurity.\n' +
        'Missing or unhealthy authenticated native IPC fails closed. Workspace files, capabilities\n' +
        'and local runtime state are never included in this archive.\n\n' +
        'The bundle is unsigned and not notarized. Signing, notarization and live desktop\n' +
        'installation QA remain release gates.\n'
    )
  );
  for (const relative of SOURCE_FILES) await addFile(relative);
  const pending = ['ajv'];
  const seen = new Set();
  while (pending.length) {
    const name = pending.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const files = RUNTIME_FILES.get(name);
    if (!files) throw new PackagingError('dependency_invalid');
    const prefix = 'node_modules/' + name;
    const installed = JSON.parse(await readInput(root, prefix + '/package.json'));
    const locked = lock.packages?.[prefix];
    if (!locked || locked.dev || installed.name !== name || installed.version !== locked.version)
      throw new PackagingError('dependency_invalid');
    if (JSON.stringify(installed.dependencies ?? {}) !== JSON.stringify(locked.dependencies ?? {}))
      throw new PackagingError('dependency_invalid');
    for (const dependency of Object.keys(installed.dependencies ?? {})) pending.push(dependency);
    // Preserve runtime metadata and license attribution while dropping development commands.
    delete installed.devDependencies;
    delete installed.scripts;
    add(prefix + '/package.json', json(installed));
    for (const file of files) {
      if (file.endsWith('/')) await walk(prefix + '/' + file.slice(0, -1));
      else await addFile(prefix + '/' + file);
    }
  }
  const native = await collectNative(root, nativeInputs);
  for (const entry of native.entries) add(entry.name, entry.data);
  add('native/native-binaries.json', json(native.metadata));
  return entries;
}

/** Atomically publishes a private artifact; a post-rename failure means uncertain durability. */
async function publish(root, bytes) {
  const directory = path.join(root, 'dist');
  await fs.mkdir(directory, { recursive: true });
  if ((await fs.lstat(directory)).isSymbolicLink() || (await fs.realpath(directory)) !== directory)
    throw new PackagingError('unsafe_input');
  const output = path.join(directory, 'krypton-protected-fs.mcpb');
  const temporary = await fs.mkdtemp(path.join(directory, '.mcpb-'));
  let published = false;
  let failure;
  try {
    const file = path.join(temporary, 'bundle');
    const handle = await fs.open(file, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(file, output);
    published = true;
    const directoryHandle = await fs.open(directory, 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    failure = new PackagingError(published ? 'durability_unknown' : 'output_failed', error);
  } finally {
    try {
      await fs.rm(temporary, { recursive: true });
    } catch (error) {
      // Cleanup cannot erase uncertainty about an already-published archive.
      failure = failure
        ? new PackagingError(
            failure.code,
            new AggregateError([failure, error], 'Publication and cleanup failed.')
          )
        : new PackagingError('cleanup_failed', error);
    }
  }
  if (failure) throw failure;
  return output;
}

/**
 * Builds an offline, reproducible extension from reviewed source/dependency inputs.
 * @param {string} projectRoot - Checkout containing installed, locked dependencies.
 * @param {{nativeInputs?: {arm64: string, x64: string}}} options - Optional native input paths;
 * relative paths resolve against the checkout. Defaults are the two dist/native release files.
 * @returns {Promise<{path:string,sha256:string,files:number}>} Published artifact metadata.
 * @complexity O(B + N L log N + N L²) time and O(B + N L²) space including ZIP
 * name validation, for B input bytes, N files and L maximum path length. Inputs
 * are capped at 256 MiB and 2048 files, with each native binary at most 128 MiB;
 * each ZIP name is at most 1024 bytes. Non-native source reads retain a 1 MiB cap.
 */
async function buildBundle(projectRoot = path.resolve(__dirname, '../..'), options = {}) {
  try {
    const root = await fs.realpath(projectRoot);
    const entries = await collectEntries(root, options.nativeInputs);
    const bytes = createZip(entries);
    const output = await publish(root, bytes);
    return {
      path: output,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      files: entries.length,
    };
  } catch (error) {
    if (error instanceof PackagingError) throw error;
    if (error && typeof error === 'object' && error.code === 'size_limit')
      throw new PackagingError('size_limit', error);
    throw new PackagingError('input_invalid', error);
  }
}

if (require.main === module)
  void runCli(async (argv) => {
    if (argv.length) {
      process.stderr.write('Usage: npm run build:mcpb\n');
      return 2;
    }
    try {
      const result = await buildBundle();
      console.log(
        `[PASS] dist/krypton-protected-fs.mcpb (${result.files} files; SHA-256 ${result.sha256})`
      );
      return 0;
    } catch (error) {
      const code = error instanceof PackagingError ? error.code : 'input_invalid';
      process.stderr.write(
        `[KRYPTON] MCPB build failed: ${code}. Verify native release inputs, installed dependencies and build-directory access.\n`
      );
      return 1;
    }
  });

module.exports = { buildBundle, createManifest, PackagingError };

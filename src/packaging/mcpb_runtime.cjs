'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const os = require('node:os');
const { constants } = fs;
const MAX_BINARY_BYTES = 128 * 1024 * 1024;
const MAX_METADATA_BYTES = 16384;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_VERSION = 128;
const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const NATIVE = {
  arm64: { path: 'native/krypton-core-native-aarch64-apple-darwin', cpu: 0x0100000c },
  x64: { path: 'native/krypton-core-native-x86_64-apple-darwin', cpu: 0x01000007 },
};

/** Public failures deliberately retain no arbitrary exception text or filesystem paths. */
class StandaloneRuntimeError extends Error {
  /** @param {import('./mcpb_runtime.cjs').StandaloneRuntimeErrorCode} code Safe category. */
  constructor(code) {
    super(code);
    this.name = 'StandaloneRuntimeError';
    this.code = code;
  }
}

/** Identifies an expected filesystem absence without swallowing other failures. */
function missing(error) {
  return error && typeof error === 'object' && error.code === 'ENOENT';
}

/** Validates bounded, round-trippable absolute paths before filesystem access. */
function absolute(value, code) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    value.includes('\0') ||
    value.length > 4096 ||
    Buffer.byteLength(value) > 4096 ||
    Buffer.from(value).toString() !== value ||
    value.split(path.sep).includes('..')
  )
    throw new StandaloneRuntimeError(code);
  return path.resolve(value);
}

/** Compares the identity pinned across a no-follow operation. */
function sameIdentity(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode;
}

/** Detects replacement, mutation, or added hard links during a bounded read. */
function unchanged(a, b) {
  return (
    sameIdentity(a, b) &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs &&
    a.nlink === b.nlink
  );
}

/** Requires owned, non-redirected directories; private descendants allow no other-user access. */
function directoryStat(stat, uid, privateMode) {
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== uid ||
    (stat.mode & (privateMode ? 0o7077 : 0o7022)) !== 0 ||
    (stat.mode & 0o700) !== 0o700
  )
    throw new StandaloneRuntimeError('unsafe_state');
}

/** Creates one directory without repairing unsafe existing state and pins its identity. */
async function directory(file, uid, pins, privateMode = true) {
  let created = false;
  try {
    await fs.mkdir(file, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'EEXIST') throw error;
  }
  const stat = await fs.lstat(file);
  directoryStat(stat, uid, privateMode);
  if ((await fs.realpath(file)) !== file) throw new StandaloneRuntimeError('unsafe_state');
  pins.set(file, stat);
  return created;
}

/** Revalidates every private ancestor before sensitive operations (no same-UID isolation claim). */
async function recheck(pins, uid) {
  for (const [file, pinned] of pins) {
    const stat = await fs.lstat(file);
    directoryStat(stat, uid, (pinned.mode & 0o077) === 0);
    if (!sameIdentity(pinned, stat) || (await fs.realpath(file)) !== file)
      throw new StandaloneRuntimeError('unsafe_state');
  }
}

/** Establishes a private root below an already canonical OS/user directory anchor. */
async function privateRoot(value, uid, pins) {
  const root = absolute(value, 'unsafe_state');
  const parent = path.dirname(root);
  if ((await fs.realpath(parent)) !== parent) throw new StandaloneRuntimeError('unsafe_state');
  await directory(root, uid, pins);
  return root;
}

/**
 * Resolves explicit directories without creating them; blank input alone selects the fallback.
 * Parent aliases of an explicit workspace are canonicalized, but a final symlink is rejected.
 * @param {unknown} configuredValue Optional installer field.
 * @param {string} applicationSupportRoot Exact private KryptonSecurity directory.
 * @returns {Promise<{path:string, usedFallback:boolean}>} Canonical protected root.
 * @complexity O(L) path processing and filesystem traversal; no directory contents are scanned.
 */
async function resolveProtectedWorkspace(configuredValue, applicationSupportRoot) {
  if (
    typeof configuredValue === 'string' &&
    (configuredValue.length > 4096 || Buffer.byteLength(configuredValue) > 4096)
  )
    throw new StandaloneRuntimeError('invalid_workspace');
  const fallback =
    configuredValue === undefined ||
    (typeof configuredValue === 'string' && /^[\s\p{White_Space}]*$/u.test(configuredValue));
  try {
    let selected;
    if (fallback) {
      const uid = os.userInfo().uid;
      const pins = new Map();
      const root = await privateRoot(applicationSupportRoot, uid, pins);
      selected = path.join(root, 'sandbox_workspace');
      await recheck(pins, uid);
      await directory(selected, uid, pins);
      await recheck(pins, uid);
    } else {
      if (typeof configuredValue !== 'string' || configuredValue.includes('${'))
        throw new StandaloneRuntimeError('invalid_workspace');
      selected = absolute(configuredValue, 'invalid_workspace');
    }
    const before = await fs.lstat(selected);
    if (!before.isDirectory() || before.isSymbolicLink())
      throw new StandaloneRuntimeError('invalid_workspace');
    await fs.access(selected, constants.R_OK | constants.W_OK | constants.X_OK);
    const canonical = await fs.realpath(selected);
    if (
      !sameIdentity(before, await fs.lstat(canonical)) ||
      !sameIdentity(before, await fs.lstat(selected))
    )
      throw new StandaloneRuntimeError('invalid_workspace');
    absolute(canonical, 'invalid_workspace');
    return { path: canonical, usedFallback: fallback };
  } catch (error) {
    if (error instanceof StandaloneRuntimeError) throw error;
    throw new StandaloneRuntimeError(fallback ? 'unsafe_state' : 'invalid_workspace');
  }
}

/** Rejects unsafe private leaves before native code can repair or consume them. */
async function privateLeaf(file, uid, mode, socket = false) {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
  if (
    stat.uid !== uid ||
    (stat.mode & 0o7777) !== mode ||
    stat.isSymbolicLink() ||
    (socket ? !stat.isSocket() : !stat.isFile() || stat.nlink !== 1)
  )
    throw new StandaloneRuntimeError('unsafe_state');
  return stat;
}

/** Reads a fixed maximum using no-follow descriptors, fixed-size chunks and before/after identity. */
async function readBounded(file, maximum, code, privateMode, uid) {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new StandaloneRuntimeError(code);
  if (privateMode !== undefined) await privateLeaf(file, uid, privateMode);
  if (before.size > maximum) throw new StandaloneRuntimeError('size_limit');
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const opened = await handle.stat();
    if (!unchanged(before, opened)) throw new StandaloneRuntimeError(code);
    const chunks = [];
    let size = 0;
    while (size <= maximum) {
      const chunk = Buffer.alloc(Math.min(65536, maximum + 1 - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maximum) throw new StandaloneRuntimeError('size_limit');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (
      size !== before.size ||
      !unchanged(before, await handle.stat()) ||
      !unchanged(before, await fs.lstat(file))
    )
      throw new StandaloneRuntimeError(code);
    return Buffer.concat(chunks, size);
  } finally {
    await handle.close();
  }
}

/** Validates exact schema keys without accepting ambiguous metadata extensions. */
function keys(value, expected) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

/** Reads only the hard-coded architecture filenames beneath non-symlink bundle components. */
async function bundledBinary(bundleRoot, arch) {
  try {
    const root = absolute(bundleRoot, 'invalid_binary');
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      throw new StandaloneRuntimeError('invalid_binary');
    const canonical = await fs.realpath(root);
    const native = path.join(canonical, 'native');
    const nativeStat = await fs.lstat(native);
    if (!nativeStat.isDirectory() || nativeStat.isSymbolicLink())
      throw new StandaloneRuntimeError('invalid_binary');
    const metadataBytes = await readBounded(
      path.join(native, 'native-binaries.json'),
      MAX_METADATA_BYTES,
      'invalid_binary'
    );
    const metadata = JSON.parse(metadataBytes.toString('utf8'));
    if (
      !keys(metadata, ['schemaVersion', 'binaries']) ||
      metadata.schemaVersion !== 1 ||
      !keys(metadata.binaries, ['arm64', 'x64'])
    )
      throw new StandaloneRuntimeError('invalid_binary');
    for (const name of ['arm64', 'x64']) {
      const record = metadata.binaries[name];
      if (
        !keys(record, ['path', 'size', 'sha256']) ||
        record.path !== NATIVE[name].path ||
        !Number.isSafeInteger(record.size) ||
        record.size < 32 ||
        record.size > MAX_BINARY_BYTES ||
        typeof record.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(record.sha256)
      )
        throw new StandaloneRuntimeError('invalid_binary');
    }
    const record = metadata.binaries[arch];
    const bytes = await readBounded(
      path.join(canonical, record.path),
      MAX_BINARY_BYTES,
      'invalid_binary'
    );
    if (
      bytes.length !== record.size ||
      createHash('sha256').update(bytes).digest('hex') !== record.sha256 ||
      bytes.readUInt32LE(0) !== 0xfeedfacf ||
      bytes.readUInt32LE(4) !== NATIVE[arch].cpu ||
      bytes.readUInt32LE(12) !== 2 ||
      !sameIdentity(rootStat, await fs.lstat(root)) ||
      !sameIdentity(nativeStat, await fs.lstat(native))
    )
      throw new StandaloneRuntimeError('invalid_binary');
    return bytes;
  } catch (error) {
    if (error instanceof StandaloneRuntimeError) throw error;
    throw new StandaloneRuntimeError('invalid_binary');
  }
}

/** Reads a caller-selected local build with bounded no-follow I/O; never falls back after failure. */
async function sourceBinary(file, arch) {
  try {
    const bytes = await readBounded(
      absolute(file, 'invalid_binary'),
      MAX_BINARY_BYTES,
      'invalid_binary'
    );
    if (
      bytes.length < 32 ||
      bytes.readUInt32LE(0) !== 0xfeedfacf ||
      bytes.readUInt32LE(4) !== NATIVE[arch].cpu ||
      bytes.readUInt32LE(12) !== 2
    )
      throw new StandaloneRuntimeError('invalid_binary');
    return bytes;
  } catch (error) {
    if (error instanceof StandaloneRuntimeError) throw error;
    throw new StandaloneRuntimeError('invalid_binary');
  }
}

/**
 * Atomically publishes a private file, preserving the previous bytes before rename.
 * Reopens/verifies the destination and syncs its directory; any later failure is durability_unknown.
 * Checkpoints detect component replacement but Node path APIs cannot defeat a hostile same-UID actor
 * swapping ancestors between syscalls. Private ownership is the operating-system trust boundary.
 */
async function publish(file, bytes, mode, uid, pins, maximum, exclusive = false) {
  await recheck(pins, uid);
  const previous = await privateLeaf(file, uid, mode);
  if (previous) {
    const installed = await readBounded(file, maximum, 'unsafe_state', mode, uid);
    if (installed.equals(bytes)) return;
    if (exclusive) throw new StandaloneRuntimeError('unsafe_state');
  }
  const parent = path.dirname(file);
  const temporary = path.join(parent, '.krypton-stage-' + randomBytes(16).toString('hex'));
  let staged;
  let created = false;
  let published = false;
  let failure;
  try {
    await recheck(pins, uid);
    const handle = await fs.open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode
    );
    created = true;
    try {
      staged = await handle.stat();
      await handle.chmod(mode);
      await handle.writeFile(bytes);
      await handle.sync();
      staged = await handle.stat();
    } finally {
      await handle.close();
    }
    await recheck(pins, uid);
    const destination = await privateLeaf(file, uid, mode);
    if (
      Boolean(previous) !== Boolean(destination) ||
      (previous && !unchanged(previous, destination))
    )
      throw new StandaloneRuntimeError('unsafe_state');
    if (!unchanged(staged, await fs.lstat(temporary)))
      throw new StandaloneRuntimeError('unsafe_state');
    if (exclusive) {
      // link() cannot replace an existing marker, including a concurrently
      // published colliding identity. Remove our staging link before verification.
      await fs.link(temporary, file);
      published = true;
      await fs.unlink(temporary);
    } else {
      await fs.rename(temporary, file);
      published = true;
    }
    await recheck(pins, uid);
    const verified = await readBounded(file, maximum, 'unsafe_state', mode, uid);
    if (!verified.equals(bytes)) throw new StandaloneRuntimeError('unsafe_state');
    const directoryHandle = await fs.open(
      parent,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY
    );
    try {
      if (!sameIdentity(pins.get(parent), await directoryHandle.stat()))
        throw new StandaloneRuntimeError('unsafe_state');
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    failure = new StandaloneRuntimeError(
      published
        ? 'durability_unknown'
        : error instanceof StandaloneRuntimeError
          ? error.code
          : 'output_failed'
    );
  } finally {
    // If the first descriptor inspection failed, identity is unknown: do not unlink
    // an unverified path or silently claim staging cleanup succeeded.
    if (created && !staged) failure = new StandaloneRuntimeError('cleanup_failed');
    if (staged && !published) {
      try {
        await recheck(pins, uid);
        // Only absence of the staging leaf is benign. Lost ancestor authority,
        // including ENOENT from recheck(), must remain a cleanup failure.
        try {
          const remaining = await fs.lstat(temporary);
          if (remaining.dev !== staged.dev || remaining.ino !== staged.ino || !remaining.isFile())
            throw new StandaloneRuntimeError('cleanup_failed');
          await fs.unlink(temporary);
        } catch (error) {
          if (!missing(error)) throw error;
          // ENOENT can also mean an ancestor vanished after the first check.
          await recheck(pins, uid);
        }
      } catch (error) {
        failure =
          error instanceof StandaloneRuntimeError && error.code === 'cleanup_failed'
            ? error
            : new StandaloneRuntimeError('cleanup_failed');
      }
    }
  }
  if (failure) throw failure;
}

/**
 * Prepares standalone state without executing code or contacting any network service.
 * @param {import('./mcpb_runtime.cjs').StandaloneRuntimeOptions} options Installed bundle and host inputs.
 * @returns {Promise<import('./mcpb_runtime.cjs').StandaloneRuntimePaths>} Validated private paths.
 * @complexity O(B + L²) time and O(B + L) memory for at most 128 MiB binary bytes and bounded paths;
 * directory rechecks traverse a fixed number of components. No workspace contents are scanned.
 */
async function prepareStandaloneRuntime(options) {
  try {
    if (options.platform !== 'darwin' || !Object.hasOwn(NATIVE, options.arch))
      throw new StandaloneRuntimeError('unsupported_platform');
    if (
      typeof options.version !== 'string' ||
      options.version.length > MAX_VERSION ||
      !/^[\x21-\x7e]+$/.test(options.version) ||
      !SEMVER.test(options.version)
    )
      throw new StandaloneRuntimeError('input_invalid');
    const uid = os.userInfo().uid;
    const pins = new Map();
    let root;
    if (options.applicationSupportRoot !== undefined)
      root = await privateRoot(options.applicationSupportRoot, uid, pins);
    else {
      const home = await fs.realpath(absolute(options.homeDirectory, 'unsafe_state'));
      directoryStat(await fs.lstat(home), uid, false);
      let parent = home;
      for (const name of ['Library', 'Application Support', 'KryptonSecurity']) {
        await recheck(pins, uid);
        parent = path.join(parent, name);
        await directory(parent, uid, pins, name === 'KryptonSecurity');
      }
      root = parent;
    }
    const workspace = await resolveProtectedWorkspace(options.configuredWorkspace, root);
    const workspaceId = createHash('sha256').update(workspace.path, 'utf8').digest('hex');
    const instanceHome = path.join(root, 'instances', workspaceId);
    // Canonicalize the OS temp trust anchor before measuring AF_UNIX bytes:
    // on macOS /var expands to /private/var and the kernel needs room for NUL.
    const temporaryRoot = await fs.realpath(
      absolute(options.temporaryDirectory ?? os.tmpdir(), 'unsafe_state')
    );
    const runtimeToken = Buffer.from(workspaceId, 'hex').toString('base64url').slice(0, 12);
    const ephemeralRoot = path.join(temporaryRoot, 'k');
    const runtimeHome = path.join(ephemeralRoot, runtimeToken);
    const runtimeDirectory = path.join(runtimeHome, '.krypton/runtime');
    if (Buffer.byteLength(path.join(runtimeDirectory, 'daemon.sock')) > 103)
      throw new StandaloneRuntimeError('unsafe_state');
    for (const destination of [instanceHome, runtimeHome]) {
      const relative = path.relative(workspace.path, destination);
      if (
        relative === '' ||
        (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
      )
        throw new StandaloneRuntimeError('unsafe_state');
    }
    await recheck(pins, uid);
    await directory(ephemeralRoot, uid, pins);
    await recheck(pins, uid);
    const createdRuntimeHome = await directory(runtimeHome, uid, pins);
    const marker = path.join(runtimeHome, 'workspace-id');
    const identityBytes = Buffer.from(workspaceId + '\n');
    const markerExists = await privateLeaf(marker, uid, 0o600);
    if (!createdRuntimeHome && !markerExists) throw new StandaloneRuntimeError('unsafe_state');
    await publish(marker, identityBytes, 0o600, uid, pins, 65, true);
    for (const child of ['.krypton', '.krypton/runtime']) {
      await recheck(pins, uid);
      await directory(path.join(runtimeHome, child), uid, pins);
    }
    for (const child of [
      'instances',
      `instances/${workspaceId}`,
      `instances/${workspaceId}/config`,
      `instances/${workspaceId}/.krypton`,
      `instances/${workspaceId}/.krypton/telemetry`,
      'bin',
      `bin/${options.version}`,
      `bin/${options.version}/${options.arch}`,
    ]) {
      await recheck(pins, uid);
      await directory(path.join(root, child), uid, pins);
    }
    const telemetryPath = path.join(instanceHome, '.krypton/telemetry/alerts.jsonl');
    const configPath = path.join(instanceHome, 'config/runtime.json');
    const daemonPath = path.join(root, 'bin', options.version, options.arch, 'krypton-core-native');
    // Native owns this persistent lock inode; preparation only validates it.
    for (const file of [
      path.join(instanceHome, '.krypton/instance.lock'),
      telemetryPath,
      configPath,
      ...['startup.lock', 'daemon.json', 'capability'].map((name) =>
        path.join(runtimeDirectory, name)
      ),
    ])
      await privateLeaf(file, uid, 0o600);
    await privateLeaf(path.join(runtimeDirectory, 'daemon.sock'), uid, 0o600, true);
    const bytes =
      options.nativeBinaryPath === undefined
        ? await bundledBinary(options.bundleRoot, options.arch)
        : await sourceBinary(options.nativeBinaryPath, options.arch);
    await publish(daemonPath, bytes, 0o700, uid, pins, MAX_BINARY_BYTES);
    const config = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        protectedWorkspaceRoot: workspace.path,
        runtimeDirectory,
        telemetryPath,
        ignoredPaths: ['node_modules', '.git', '.krypton'],
        telemetryMaxEvents: 10000,
        telemetryMaxBytes: 8388608,
        rateLimitWindowSeconds: 10,
        rateLimitMaxBreakouts: 3,
      }) + '\n'
    );
    await publish(configPath, config, 0o600, uid, pins, MAX_CONFIG_BYTES);
    await recheck(pins, uid);
    return {
      protectedWorkspaceRoot: workspace.path,
      runtimeHome,
      runtimeDirectory,
      telemetryPath,
      configPath,
      daemonPath,
      workspaceId,
    };
  } catch (error) {
    if (error instanceof StandaloneRuntimeError) throw error;
    throw new StandaloneRuntimeError('unsafe_state');
  }
}

module.exports = { StandaloneRuntimeError, resolveProtectedWorkspace, prepareStandaloneRuntime };

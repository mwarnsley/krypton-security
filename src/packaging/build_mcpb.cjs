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
  'src/core/supervisor.cjs',
  'src/core/mcp/server.cjs',
  'src/packaging/launch_mcpb.cjs',
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
const MAX_TOTAL = 16 * MAX_FILE;

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
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.test(
      version
    )
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
      entry_point: 'src/core/mcp/server.cjs',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/src/packaging/launch_mcpb.cjs'],
        env: { KRYPTON_PROJECT_ROOT: '${user_config.project_root}' },
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
      project_root: {
        type: 'directory',
        title: 'Krypton checkout directory',
        description:
          'Select your Krypton checkout containing krypton.config.json. Start its native daemon with npm run dev:full before enabling this extension.',
        required: true,
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

/** Collects only reviewed runtime sources and the lockfile-matched Ajv dependency closure. */
async function collectEntries(root) {
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
        'Select an existing Krypton checkout during installation. Start its native daemon\n' +
        'with npm run dev:full before enabling this extension. Only the two Krypton file\n' +
        'tools are contained. Missing or unhealthy native IPC fails closed.\n\n' +
        'This bundle includes JavaScript runtime dependencies, not a native daemon,\n' +
        'Node runtime, telemetry, capabilities or workspace files. macOS is supported;\n' +
        'desktop installation still requires manual client QA.\n'
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
 * @returns {Promise<{path:string,sha256:string,files:number}>} Published artifact metadata.
 * @complexity O(B + N L log N + N L²) time and O(B + N L²) space including ZIP
 * name validation, for B input bytes, N files and L maximum path length. Inputs
 * are capped at 16 MiB and 2048 files; each ZIP name is at most 1024 bytes.
 */
async function buildBundle(projectRoot = path.resolve(__dirname, '../..')) {
  try {
    const root = await fs.realpath(projectRoot);
    const entries = await collectEntries(root);
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
        `[KRYPTON] MCPB build failed: ${code}. Verify installed dependencies and build-directory access.\n`
      );
      return 1;
    }
  });

module.exports = { buildBundle, createManifest, PackagingError };

#!/usr/bin/env node
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
const SERVER_NAME = 'krypton-protected-fs';

/** A redacted setup failure; the cause is retained only for local callers. */
class SetupError extends Error {
  /**
   * @param {import('./setup.cjs').SetupErrorCode} code - Safe setup category.
   * @param {unknown} cause - Underlying failure, never printed to clients.
   */
  constructor(code, cause) {
    super(code, { cause });
    this.name = 'SetupError';
    this.code = code;
  }
}

/** Returns whether a JSON value is an object suitable for a settings map. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reads a bounded regular file without following its final symlink. */
async function readConfig(file) {
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) throw new SetupError('invalid_config_file');
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > MAX_CONFIG_BYTES) throw new SetupError('config_too_large');
    return buffer.subarray(0, size);
  } catch (error) {
    if (error instanceof Error && error.code === 'ENOENT') return undefined;
    throw error;
  } finally {
    await handle?.close();
  }
}

/** Publishes a private, synced file with an exclusive temporary and atomic rename. */
async function atomicWrite(file, bytes) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  let published = false;
  let created = false;
  let failure;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    created = true;
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, file);
    published = true;
    const directory = await fs.open(path.dirname(file), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    failure = new SetupError(published ? 'durability_unknown' : 'write_failed', error);
  } finally {
    const cleanup = await Promise.allSettled([
      handle?.close(),
      // After publication the temporary name is no longer ours to remove.
      published || !created ? Promise.resolve() : fs.rm(temporary, { force: true }),
    ]);
    if (cleanup.some((result) => result.status === 'rejected'))
      failure = new SetupError('cleanup_failed', failure);
  }
  if (failure) throw failure;
}

/** Detects known client storage and atomically adds the supervisor without changing other servers. */
async function setupClients(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'linux') throw new SetupError('unsupported_platform');
  const home = await fs.realpath(options.homeDir ?? os.homedir());
  let configHome = options.configHome ?? process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  if (!path.isAbsolute(configHome)) throw new SetupError('invalid_config_home');
  configHome = await fs.realpath(configHome).catch((error) => {
    if (error instanceof Error && error.code === 'ENOENT') return configHome;
    throw error;
  });
  const applicationSupport =
    platform === 'darwin' ? path.join(home, 'Library/Application Support') : configHome;
  const cline = path.join(applicationSupport, 'Code/User/globalStorage/saoudrizwan.claude-dev');
  const clients = [
    {
      client: 'Claude Desktop',
      directory: path.join(applicationSupport, 'Claude'),
      file: path.join(applicationSupport, 'Claude/claude_desktop_config.json'),
    },
    {
      client: 'Cursor',
      directory: path.join(home, '.cursor'),
      file: path.join(home, '.cursor/mcp.json'),
    },
    {
      client: 'Claude Code',
      directory: path.join(home, '.claude'),
      file: path.join(home, '.claude.json'),
    },
    {
      client: 'Cline',
      directory: cline,
      file: path.join(cline, 'settings/cline_mcp_settings.json'),
    },
  ];
  const root = await fs.realpath(path.resolve(__dirname, '../..'));
  await fs.access(path.join(root, 'src/cli.cjs'));
  await fs.access(path.join(root, 'src/core/mcp/server.cjs'));
  const entry = {
    command: 'node',
    args: [
      path.join(root, 'src/cli.cjs'),
      'run',
      '--',
      'node',
      path.join(root, 'src/core/mcp/server.cjs'),
    ],
    env: { KRYPTON_PROJECT_ROOT: root },
  };
  const results = [];
  for (const client of clients) {
    let lock;
    const lockPath = `${client.file}.krypton-setup.lock`;
    try {
      const existing = await fs.lstat(client.file).catch((error) => {
        if (error instanceof Error && error.code === 'ENOENT') return undefined;
        throw error;
      });
      const directory = await fs.lstat(client.directory).catch((error) => {
        if (error instanceof Error && error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (!existing && !directory) {
        results.push({ client: client.client, status: 'skipped', reason: 'not_detected' });
        continue;
      }
      if (
        directory &&
        (!directory.isDirectory() || (await fs.realpath(client.directory)) !== client.directory)
      )
        throw new SetupError('unsafe_client_directory');
      if (existing && !existing.isFile()) throw new SetupError('invalid_config_file');
      if (client.client === 'Cline')
        await fs.mkdir(path.dirname(client.file), { recursive: true, mode: 0o700 });
      if ((await fs.realpath(path.dirname(client.file))) !== path.dirname(client.file))
        throw new SetupError('unsafe_config_directory');
      lock = await fs.open(lockPath, 'wx', 0o600);
      const original = await readConfig(client.file);
      const config = original === undefined ? {} : JSON.parse(original.toString('utf8'));
      if (!isRecord(config) || (config.mcpServers !== undefined && !isRecord(config.mcpServers)))
        throw new SetupError('invalid_json_shape');
      const servers = config.mcpServers ?? {};
      if (Object.hasOwn(servers, SERVER_NAME)) {
        if (!isDeepStrictEqual(servers[SERVER_NAME], entry))
          throw new SetupError('server_name_conflict');
        results.push({ client: client.client, status: 'skipped', reason: 'already_configured' });
        continue;
      }
      const updated = Buffer.from(
        `${JSON.stringify({ ...config, mcpServers: { ...servers, [SERVER_NAME]: entry } }, null, 2)}\n`
      );
      if (updated.length > MAX_CONFIG_BYTES) throw new SetupError('config_too_large');
      if (original !== undefined) await atomicWrite(`${client.file}.bak`, original);
      // Detect ordinary concurrent client edits before replacement; close clients during setup.
      const current = await readConfig(client.file);
      if (!isDeepStrictEqual(current, original))
        throw new SetupError('config_changed_during_setup');
      await atomicWrite(client.file, updated);
      results.push({ client: client.client, status: 'configured', reason: 'supervisor_installed' });
    } catch (error) {
      const safeReasons = new Set([
        'unsafe_client_directory',
        'unsafe_config_directory',
        'invalid_config_file',
        'invalid_json_shape',
        'config_too_large',
        'server_name_conflict',
        'config_changed_during_setup',
        'durability_unknown',
        'write_failed',
        'cleanup_failed',
      ]);
      results.push({
        client: client.client,
        status: 'failed',
        reason:
          error instanceof SetupError && safeReasons.has(error.code)
            ? error.code
            : error instanceof SyntaxError
              ? 'invalid_json'
              : 'filesystem_error',
      });
    } finally {
      if (lock) {
        const cleanup = await Promise.allSettled([lock.close(), fs.rm(lockPath, { force: true })]);
        if (cleanup.some((result) => result.status === 'rejected')) {
          const result = results[results.length - 1];
          result.status = 'failed';
          result.reason = 'cleanup_failed';
        }
      }
    }
  }
  return results;
}

/** Runs setup independently of daemon reachability and prints no existing configuration values. */
async function main(argv = process.argv.slice(2), options = {}) {
  const write = options.write ?? ((text) => process.stdout.write(text));
  const writeError = options.writeError ?? ((text) => process.stderr.write(text));
  if (argv.length !== 0) {
    writeError('Usage: krypton setup\n');
    return 2;
  }
  try {
    const results = await setupClients(options);
    for (const result of results)
      (result.status === 'failed' ? writeError : write)(
        `${result.status.toUpperCase()} ${result.client}: ${result.reason}\n`
      );
    write('Restart configured clients. Start the native daemon with npm run dev:full.\n');
    return results.some((row) => row.status === 'failed') ? 1 : 0;
  } catch (error) {
    const code = error instanceof SetupError ? error.code : 'filesystem_error';
    writeError(`FAILED Krypton setup: ${code}; check platform and client storage.\n`);
    return 1;
  }
}

module.exports = { setupClients, main, SetupError };
if (require.main === module) void require('./runtime.cjs').runCli(main);

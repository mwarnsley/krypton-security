import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { setupClients, main } = require('../../src/cli/setup.cjs') as {
  main(argv: string[], options?: Record<string, unknown>): Promise<number>;
  setupClients(options: {
    homeDir: string;
    platform: string;
    configHome?: string;
  }): Promise<{ client: string; status: string; reason: string }[]>;
};
let homeDir: string;
beforeEach(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'krypton-setup-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(homeDir, { recursive: true, force: true });
});
const locations = [
  ['Claude Desktop', 'Library/Application Support/Claude/claude_desktop_config.json'],
  ['Cursor', '.cursor/mcp.json'],
  ['Claude Code', '.claude.json'],
  [
    'Cline',
    'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
  ],
] as const;

describe('universal client setup', () => {
  it('keeps another setup lock and config intact', async () => {
    const file = path.join(homeDir, '.claude.json');
    await fs.writeFile(file, '{}');
    await fs.writeFile(`${file}.krypton-setup.lock`, 'owned by another setup');
    const results = await setupClients({ homeDir, platform: 'darwin' });
    expect(results.find((row) => row.client === 'Claude Code')?.status).toBe('failed');
    expect(await fs.readFile(file, 'utf8')).toBe('{}');
    expect(await fs.readFile(`${file}.krypton-setup.lock`, 'utf8')).toBe('owned by another setup');
  });
  it('rejects oversized configuration before creating a backup', async () => {
    const file = path.join(homeDir, '.claude.json');
    await fs.writeFile(file, ' '.repeat(4 * 1024 * 1024 + 1));
    const results = await setupClients({ homeDir, platform: 'darwin' });
    expect(results.find((row) => row.client === 'Claude Code')?.status).toBe('failed');
    await expect(fs.stat(`${file}.bak`)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('replaces a backup symlink privately without changing its target', async () => {
    const file = path.join(homeDir, '.claude.json');
    const target = path.join(homeDir, 'unrelated');
    await fs.writeFile(file, '{}');
    await fs.writeFile(target, 'untouched');
    await fs.symlink(target, `${file}.bak`);
    await setupClients({ homeDir, platform: 'darwin' });
    expect(await fs.readFile(target, 'utf8')).toBe('untouched');
    expect(await fs.readFile(`${file}.bak`, 'utf8')).toBe('{}');
    expect((await fs.stat(`${file}.bak`)).mode & 0o777).toBe(0o600);
  });
  it.each(locations)('preserves existing settings and backs up %s', async (client, relative) => {
    const file = path.join(homeDir, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const original = '{"theme":"system","mcpServers":{"other":{"command":"other"}}}';
    await fs.writeFile(file, original);
    const results = await setupClients({ homeDir, platform: 'darwin' });
    const updated = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(results.find((row) => row.client === client)?.status).toBe('configured');
    expect(updated).toMatchObject({
      theme: 'system',
      mcpServers: {
        other: { command: 'other' },
        'krypton-protected-fs': {
          command: 'node',
          env: { KRYPTON_PROJECT_ROOT: await fs.realpath(process.cwd()) },
        },
      },
    });
    expect(await fs.readFile(`${file}.bak`, 'utf8')).toBe(original);
  });
  it('skips absent clients without creating installation directories', async () => {
    expect(
      (await setupClients({ homeDir, platform: 'darwin' })).every((row) => row.status === 'skipped')
    ).toBe(true);
    expect(await fs.readdir(homeDir)).toEqual([]);
  });
  it('creates config for an existing Claude Code directory and is idempotent', async () => {
    await fs.mkdir(path.join(homeDir, '.claude'));
    await setupClients({ homeDir, platform: 'linux' });
    const file = path.join(homeDir, '.claude.json');
    const before = await fs.readFile(file, 'utf8');
    await setupClients({ homeDir, platform: 'linux' });
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    await expect(fs.stat(`${file}.bak`)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each([
    '{',
    '[]',
    '{"mcpServers":[]}',
    '{"mcpServers":{"krypton-protected-fs":{"command":"other"}}}',
  ])('fails closed without overwriting invalid or conflicting settings %s', async (original) => {
    const file = path.join(homeDir, '.claude.json');
    await fs.writeFile(file, original);
    const results = await setupClients({ homeDir, platform: 'darwin' });
    expect(results.find((row) => row.client === 'Claude Code')?.status).toBe('failed');
    expect(await fs.readFile(file, 'utf8')).toBe(original);
  });
  it('does not follow a settings symlink', async () => {
    const target = path.join(homeDir, 'private');
    await fs.writeFile(target, '{}');
    await fs.symlink(target, path.join(homeDir, '.claude.json'));
    const result = await setupClients({ homeDir, platform: 'darwin' });
    expect(result.find((row) => row.client === 'Claude Code')?.status).toBe('failed');
    expect(await fs.readFile(target, 'utf8')).toBe('{}');
  });
  it('uses Linux XDG client storage when present', async () => {
    const configHome = path.join(homeDir, 'config');
    const directory = path.join(configHome, 'Code/User/globalStorage/saoudrizwan.claude-dev');
    await fs.mkdir(directory, { recursive: true });
    const result = await setupClients({ homeDir, configHome, platform: 'linux' });
    expect(result.find((row) => row.client === 'Cline')?.status).toBe('configured');
    expect(
      JSON.parse(
        await fs.readFile(path.join(directory, 'settings/cline_mcp_settings.json'), 'utf8')
      ).mcpServers['krypton-protected-fs'].args.slice(1, 4)
    ).toEqual(['run', '--', 'node']);
  });
});

describe('setup error boundaries', () => {
  it('reports uncertain durability after configuration publication', async () => {
    await fs.mkdir(path.join(homeDir, '.claude'));
    const original = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await original(file, flags, mode);
      if (String(file) === (await fs.realpath(homeDir)))
        vi.spyOn(handle, 'sync').mockRejectedValue(new Error('storage detail'));
      return handle;
    });
    const results = await setupClients({ homeDir, platform: 'darwin' });
    expect(results.find((row) => row.client === 'Claude Code')).toMatchObject({
      status: 'failed',
      reason: 'durability_unknown',
    });
    expect(
      JSON.parse(await fs.readFile(path.join(homeDir, '.claude.json'), 'utf8')).mcpServers
    ).toHaveProperty('krypton-protected-fs');
  });
  it('reports invalid usage on stderr with exit 2', async () => {
    const write = vi.fn();
    const writeError = vi.fn();
    expect(await main(['invalid'], { write, writeError })).toBe(2);
    expect(writeError).toHaveBeenCalledWith('Usage: krypton setup\n');
    expect(write).not.toHaveBeenCalled();
  });
  it('continues other clients after lock cleanup failure', async () => {
    await fs.mkdir(path.join(homeDir, '.cursor'));
    await fs.mkdir(path.join(homeDir, '.claude'));
    const original = fs.rm.bind(fs);
    vi.spyOn(fs, 'rm').mockImplementation(async (file, options) => {
      if (String(file).endsWith('.cursor/mcp.json.krypton-setup.lock'))
        throw new Error('private detail');
      return original(file, options);
    });
    const results = await setupClients({ homeDir, platform: 'darwin' });
    expect(results.find((row) => row.client === 'Cursor')).toMatchObject({
      status: 'failed',
      reason: 'cleanup_failed',
    });
    expect(results.find((row) => row.client === 'Claude Code')?.status).toBe('configured');
  });
  it('does not expose arbitrary thrown values', async () => {
    vi.spyOn(fs, 'lstat').mockRejectedValue(null);
    const results = await setupClients({ homeDir, platform: 'darwin' });
    expect(results.every((row) => row.reason === 'filesystem_error')).toBe(true);
  });
  it('preserves original configuration on failed atomic publication', async () => {
    const file = path.join(homeDir, '.claude.json');
    await fs.writeFile(file, '{}');
    vi.spyOn(fs, 'rename').mockRejectedValue(new Error('private detail'));
    const results = await setupClients({ homeDir, platform: 'darwin' });
    expect(results.find((row) => row.client === 'Claude Code')?.status).toBe('failed');
    expect(await fs.readFile(file, 'utf8')).toBe('{}');
  });
});

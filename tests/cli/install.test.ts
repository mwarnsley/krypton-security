import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const childProcess = require('node:child_process') as typeof import('node:child_process');

const { main } = require('../../src/cli/install.cjs') as typeof import('../../src/cli/install.cjs');
let homeDir: string;
beforeEach(async () => {
  homeDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'krypton-install-')));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(homeDir, { recursive: true, force: true });
});

function options() {
  const messages: string[] = [];
  return {
    homeDir,
    platform: 'darwin',
    write: (text: string) => messages.push(text),
    writeError: (text: string) => messages.push(text),
    notify: vi.fn(async () => undefined),
    messages,
  };
}

describe('double-click setup', () => {
  it('bounds native notification execution and reports subprocess failure', async () => {
    const execute = vi.spyOn(childProcess, 'execFile').mockImplementation((...args) => {
      const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void;
      queueMicrotask(() => callback(new Error('sensitive stderr'), '', 'sensitive stderr'));
      return new childProcess.ChildProcess();
    });
    const o = options();
    expect(
      await main([], { homeDir, platform: o.platform, write: o.write, writeError: o.writeError })
    ).toBe(1);
    expect(execute).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      expect.any(Array),
      { timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 4096 },
      expect.any(Function)
    );
    expect(o.messages.join('')).not.toContain('sensitive stderr');
  });
  it('configures a detected client through the shared engine before completion', async () => {
    await fs.mkdir(path.join(homeDir, '.cursor'));
    const o = options();
    o.notify.mockImplementation(async () => {
      const config = JSON.parse(await fs.readFile(path.join(homeDir, '.cursor/mcp.json'), 'utf8'));
      expect(config.mcpServers['krypton-protected-fs'].command).toBe('node');
    });
    expect(await main([], o)).toBe(0);
    expect(o.notify).toHaveBeenCalledOnce();
  });
  it('does not notify success when configuration fails', async () => {
    await fs.mkdir(path.join(homeDir, '.cursor'));
    await fs.writeFile(path.join(homeDir, '.cursor/mcp.json'), '{');
    const o = options();
    expect(await main([], o)).toBe(1);
    expect(o.notify).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(homeDir, '.cursor/mcp.json'), 'utf8')).toBe('{');
  });
  it('reports notification failure without rolling back successful settings', async () => {
    await fs.mkdir(path.join(homeDir, '.cursor'));
    const o = options();
    o.notify.mockRejectedValue(new Error('private value'));
    expect(await main([], o)).toBe(1);
    expect(o.messages.join('')).toContain('notification_failed');
    expect(o.messages.join('')).not.toContain('private value');
    expect(await fs.readFile(path.join(homeDir, '.cursor/mcp.json'), 'utf8')).toContain(
      'krypton-protected-fs'
    );
  });
  it.each(['win32', 'linux'])(
    'refuses the Mac installer on %s before writing',
    async (platform) => {
      const o = { ...options(), platform };
      expect(await main([], o)).toBe(1);
      expect(await fs.readdir(homeDir)).toEqual([]);
      expect(o.notify).not.toHaveBeenCalled();
    }
  );
  it('rejects arguments without changing settings', async () => {
    const o = options();
    expect(await main(['unexpected'], o)).toBe(2);
    expect(await fs.readdir(homeDir)).toEqual([]);
    expect(o.notify).not.toHaveBeenCalled();
  });
});

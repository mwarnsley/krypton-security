import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { main, resolveWorkspace } from '../../src/core/supervisor.cjs';

let root: string;
const config = {
  projectRoot: '.',
  protectedWorkspaceRoot: 'sandbox_workspace',
  runtimeDirectory: '.krypton/runtime',
};
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'krypton-workspace-test-')));
  await fs.mkdir(path.join(root, 'sandbox_workspace/subdir'), { recursive: true });
  await fs.writeFile(path.join(root, 'krypton.config.json'), JSON.stringify(config));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

describe('canonical supervisor workspace', () => {
  it('selects the configured protected directory from the checkout root', async () => {
    expect(await resolveWorkspace(root)).toEqual({
      repositoryRoot: root,
      projectRoot: root,
      cwd: path.join(root, 'sandbox_workspace'),
    });
  });
  it('preserves an invocation directory already inside the protected root', async () => {
    const cwd = path.join(root, 'sandbox_workspace/subdir');
    expect((await resolveWorkspace(cwd)).cwd).toBe(cwd);
  });
  it.each(['../escape', '.', '/tmp', 'sandbox_workspace/../sandbox_workspace'])(
    'rejects an unsafe protected root %s',
    async (protectedWorkspaceRoot) => {
      await fs.writeFile(
        path.join(root, 'krypton.config.json'),
        JSON.stringify({ ...config, protectedWorkspaceRoot })
      );
      await expect(resolveWorkspace(root)).rejects.toThrow();
    }
  );
  it('rejects a symlink escaping the configured project', async () => {
    await fs.symlink(os.tmpdir(), path.join(root, 'escaped'));
    await fs.writeFile(
      path.join(root, 'krypton.config.json'),
      JSON.stringify({ ...config, protectedWorkspaceRoot: 'escaped' })
    );
    await expect(resolveWorkspace(root)).rejects.toThrow();
  });
  it('rejects a sibling of the protected workspace', async () => {
    await fs.mkdir(path.join(root, 'sandbox_workspace-other'));
    await expect(resolveWorkspace(path.join(root, 'sandbox_workspace-other'))).rejects.toThrow();
  });
  it('rejects malformed config without a runtime fallback', async () => {
    await fs.writeFile(path.join(root, 'krypton.config.json'), '{');
    await expect(resolveWorkspace(root)).rejects.toThrow();
  });
  it('uses an explicit project root for desktop hosts without a working-directory setting', async () => {
    vi.stubEnv('KRYPTON_PROJECT_ROOT', root);
    expect((await resolveWorkspace()).cwd).toBe(path.join(root, 'sandbox_workspace'));
  });
  it('rejects a relative project-root override', async () => {
    vi.stubEnv('KRYPTON_PROJECT_ROOT', './relative');
    await expect(resolveWorkspace()).rejects.toThrow('absolute');
  });
  it('rejects oversized configuration', async () => {
    await fs.writeFile(path.join(root, 'krypton.config.json'), ' '.repeat(16385));
    await expect(resolveWorkspace(root)).rejects.toThrow();
  });
  it('starts the foreground daemon through Cargo without a shell', async () => {
    await fs.mkdir(path.join(root, 'src/core-native'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src/core-native/Cargo.toml'),
      '# disposable access fixture'
    );
    const child = Object.assign(new EventEmitter(), { pid: 62001, kill: vi.fn() });
    const spawn = vi.fn().mockImplementation(() => {
      setImmediate(() => child.emit('exit', 0, null));
      return child;
    });
    const code = await main(['daemon:start'], {
      resolveWorkspace: () => resolveWorkspace(root),
      spawn,
      platform: 'darwin',
      signals: new EventEmitter(),
    });
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      'cargo',
      ['run', '--manifest-path', path.join(root, 'src/core-native/Cargo.toml')],
      { cwd: root, stdio: 'inherit', shell: false }
    );
  });
});

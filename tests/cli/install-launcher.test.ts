import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let root: string;
let checkout: string;
let bin: string;
let launcher: string;
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'krypton-launcher-')));
  checkout = path.join(root, 'checkout with spaces');
  bin = path.join(root, 'bin');
  launcher = path.join(checkout, 'scripts/Install-Mac.command');
  await fs.mkdir(path.dirname(launcher), { recursive: true });
  await fs.mkdir(bin);
  await fs.copyFile('scripts/Install-Mac.command', launcher);
  await fs.symlink('/usr/bin/dirname', path.join(bin, 'dirname'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('Mac shell launcher', () => {
  it('resolves its checkout from another directory and preserves arguments and exit status', async () => {
    await fs.writeFile(
      path.join(bin, 'node'),
      '#!/bin/bash\nprintf "%s\\n" "$PWD" "$@"\nexit 23\n',
      { mode: 0o700 }
    );
    const result = spawnSync('/bin/bash', [launcher, 'argument with spaces'], {
      cwd: root,
      env: { ...process.env, PATH: bin },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(23);
    expect(result.stdout).toBe(`${checkout}\nsrc/cli/install.cjs\nargument with spaces\n`);
  });
  it('fails with an actionable diagnostic if Node is unavailable', () => {
    const result = spawnSync('/bin/bash', [launcher], {
      cwd: root,
      env: { ...process.env, PATH: bin },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('node_missing');
  });
});

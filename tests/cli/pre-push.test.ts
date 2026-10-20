import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const hook = path.resolve('.githooks/pre-push');
let root = '';
let checkout: string;
let bin: string;
let log: string;
let head: string;

function git(...args: string[]): string {
  const result = spawnSync(
    'git',
    [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      ...args,
    ],
    { cwd: checkout, encoding: 'utf8', timeout: 30_000, maxBuffer: 128 * 1024 }
  );
  if (result.error || result.status !== 0) throw new Error('Disposable Git fixture failed');
  return result.stdout.trim();
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'krypton-pre-push-')));
  checkout = path.join(root, 'checkout with spaces');
  bin = path.join(root, 'bin');
  log = path.join(root, 'npm-invocations');
  await mkdir(checkout);
  await mkdir(bin);
  await writeFile(log, '');
  await writeFile(path.join(checkout, 'README.md'), 'Disposable fixture\n');
  git('init', '--quiet', '-b', 'test');
  git('add', 'README.md');
  git('commit', '--quiet', '-m', 'fixture');
  head = git('rev-parse', 'HEAD');
  await writeFile(
    path.join(bin, 'npm'),
    `#!/bin/sh
set -eu
printf '%s|%s\\n' "$PWD" "$*" >> "$KRYPTON_HOOK_TEST_LOG"
if [ "$*" = "\${KRYPTON_HOOK_TEST_FAIL:-}" ]; then exit 23; fi
if [ "$*" = "\${KRYPTON_HOOK_TEST_DIRTY:-}" ]; then printf 'Changed during verification\\n' > README.md; fi
`,
    { mode: 0o700 }
  );
}, 30_000);

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
}, 30_000);

function runHook(fail = '', oid = head, dirty = '') {
  return spawnSync('/bin/sh', [hook], {
    cwd: checkout,
    input: `refs/heads/test ${oid} refs/heads/test ${'0'.repeat(40)}\n`,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      KRYPTON_HOOK_TEST_LOG: log,
      KRYPTON_HOOK_TEST_FAIL: fail,
      KRYPTON_HOOK_TEST_DIRTY: dirty,
    },
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 128 * 1024,
  });
}

it('runs targeted tests, the full gate and formatting in the checkout before allowing a push', async () => {
  const result = runHook();
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect((await readFile(log, 'utf8')).split('\n').filter(Boolean)).toEqual([
    `${checkout}|run test:actions`,
    `${checkout}|run verify`,
    `${checkout}|run format:check`,
  ]);
}, 30_000);

it.each(['test:actions', 'verify', 'format:check'])(
  'blocks a push if %s fails without executing later gates',
  async (script) => {
    const result = runHook(`run ${script}`);
    expect(result.status).toBe(23);
    const calls = (await readFile(log, 'utf8')).split('\n').filter(Boolean);
    const scripts = ['test:actions', 'verify', 'format:check'];
    expect(calls).toEqual(
      scripts.slice(0, scripts.indexOf(script) + 1).map((name) => `${checkout}|run ${name}`)
    );
  },
  30_000
);

it.each(['README.md', 'untracked.txt'])(
  'refuses to verify a dirty checkout (%s)',
  async (name) => {
    await writeFile(path.join(checkout, name), 'Uncommitted work\n');
    expect(runHook().status).toBe(1);
    expect(await readFile(log, 'utf8')).toBe('');
  },
  30_000
);

it('rejects a pushed commit other than the checked-out HEAD', async () => {
  const older = head;
  await writeFile(path.join(checkout, 'README.md'), 'Second fixture commit\n');
  git('add', 'README.md');
  git('commit', '--quiet', '-m', 'second fixture');
  expect(runHook('', older).status).toBe(1);
  expect(await readFile(log, 'utf8')).toBe('');
}, 30_000);

it('blocks changes made while verification is running', async () => {
  expect(runHook('', head, 'run verify').status).toBe(1);
  expect(await readFile(log, 'utf8')).toContain('run format:check');
}, 30_000);

it('accepts an annotated tag that peels to the checked-out commit', () => {
  git('-c', 'tag.gpgsign=false', 'tag', '-a', 'fixture-tag', '-m', 'fixture tag');
  expect(runHook('', git('rev-parse', 'fixture-tag')).status).toBe(0);
}, 30_000);

it('can be installed as an executable Git hook', async () => {
  const installed = path.join(checkout, '.git/hooks/pre-push');
  await copyFile(hook, installed);
  const result = spawnSync(
    'git',
    ['-c', `core.hooksPath=${path.dirname(installed)}`, 'hook', 'run', 'pre-push'],
    {
      cwd: checkout,
      input: `refs/heads/test ${head} refs/heads/test ${'0'.repeat(40)}\n`,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
        KRYPTON_HOOK_TEST_LOG: log,
      },
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 128 * 1024,
    }
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(await readFile(log, 'utf8')).toContain('run verify');
}, 30_000);

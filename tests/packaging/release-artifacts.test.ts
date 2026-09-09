import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReleaseError,
  validateReleaseTag,
  verifyChecksums,
  writeChecksums,
} from '../../scripts/release-artifacts.cjs';

const names = [
  'krypton-core-native-aarch64-apple-darwin',
  'krypton-core-native-x86_64-apple-darwin',
  'krypton-protected-fs.mcpb',
];
const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const script = path.resolve('scripts/release-artifacts.cjs');

describe('strict release tag validation', () => {
  it.each(['0.0.0', '1.2.3', '10.20.30-rc.1', '1.0.0+build.01', '1.0.0-alpha-1+build'])(
    'accepts exact SemVer %s',
    (version) => {
      expect(validateReleaseTag(`v${version}`, version)).toBe(version);
    }
  );

  it.each([
    '',
    '1.2.3',
    'V1.2.3',
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
    'v1.2',
    'v1.2.3\n',
    ' v1.2.3',
    'v1.2.3-01',
    'v1.2.3-alpha..1',
    'v1.2.3+',
    'v1.2.3/../x',
  ])('rejects noncanonical tag %j', (tag) => {
    expect(() => validateReleaseTag(tag, '1.2.3')).toThrowError(ReleaseError);
  });

  it.each(['1.2.4', '1.2.3+build', '1.2.3-rc.1', '01.2.3'])(
    'rejects mismatching package version %s',
    (version) => {
      expect(() => validateReleaseTag('v1.2.3', version)).toThrowError(ReleaseError);
    }
  );

  it.each(['1.2.3\n', '1.2.3\r', '1.2.3 ', '1.2.3\0', `1.2.3+${'a'.repeat(256)}`])(
    'rejects a matching malformed package version %j',
    (version) => {
      expect(() => validateReleaseTag(`v${version}`, version)).toThrowError(ReleaseError);
    }
  );

  it.each([undefined, null, 123, {}, []])('rejects malformed version input %j', (version) => {
    expect(() => validateReleaseTag('v1.2.3', version)).toThrowError(ReleaseError);
  });
});

describe('release artifact checksum boundary', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'krypton-release-'));
    await Promise.all(names.map((name) => writeFile(path.join(directory, name), 'abc')));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('writes portable ASCII sorted checksum bytes and verifies all seven files', async () => {
    await writeChecksums(directory);
    expect(await readFile(path.join(directory, 'SHA256SUMS'), 'utf8')).toBe(
      names.map((name) => `${digest}  ${name}\n`).join('')
    );
    expect(await verifyChecksums(directory)).toHaveLength(3);
    expect(await readdir(directory)).toHaveLength(7);
  });

  it.each(names)('preserves %s and creates its private sidecar', async (name) => {
    const before = await stat(path.join(directory, name));
    await writeChecksums(directory);
    expect(await readFile(path.join(directory, `${name}.sha256`), 'utf8')).toBe(
      `${digest}  ${name}\n`
    );
    expect((await stat(path.join(directory, `${name}.sha256`))).mode & 0o777).toBe(0o600);
    expect(await stat(path.join(directory, name))).toMatchObject({
      ino: before.ino,
      size: before.size,
      mtimeMs: before.mtimeMs,
    });
  });

  it.each(['unknown', '.hidden', 'SHA256SUMS', `${names[0]}.sha256`])(
    'rejects extra or existing output %s without overwriting',
    async (extra) => {
      await writeFile(path.join(directory, extra), 'keep');
      await expect(writeChecksums(directory)).rejects.toBeInstanceOf(ReleaseError);
      expect(await readFile(path.join(directory, extra), 'utf8')).toBe('keep');
      expect(await readdir(directory)).toHaveLength(4);
    }
  );

  it('rejects missing primary files', async () => {
    await rm(path.join(directory, names[0]!));
    await expect(writeChecksums(directory)).rejects.toBeInstanceOf(ReleaseError);
  });

  it('rejects symlink primary files', async () => {
    await rm(path.join(directory, names[0]!));
    await symlink(path.join(directory, names[1]!), path.join(directory, names[0]!));
    await expect(writeChecksums(directory)).rejects.toBeInstanceOf(ReleaseError);
  });

  it('rejects symlink directories', async () => {
    const alias = path.join(directory, 'alias');
    await symlink(directory, alias);
    await expect(writeChecksums(alias)).rejects.toBeInstanceOf(ReleaseError);
  });

  it('rejects lexical traversal before accessing a directory', async () => {
    await expect(
      writeChecksums(`${directory}/../${path.basename(directory)}`)
    ).rejects.toBeInstanceOf(ReleaseError);
  });

  it.each([0, 128 * 1024 * 1024 + 1])(
    'rejects artifact size %i before creating outputs',
    async (size) => {
      await truncate(path.join(directory, names[0]!), size);
      await expect(writeChecksums(directory)).rejects.toBeInstanceOf(ReleaseError);
      expect(await readdir(directory)).toHaveLength(3);
    }
  );

  it.each([128 * 1024 * 1024 - 1, 128 * 1024 * 1024])(
    'accepts artifact size %i within the bound',
    async (size) => {
      await truncate(path.join(directory, names[0]!), size);
      await expect(writeChecksums(directory)).resolves.toHaveLength(3);
    }
  );

  it('returns a typed failure when checksum output cannot be created', async () => {
    const filesystem: typeof import('node:fs/promises') = require('node:fs/promises');
    const originalOpen = filesystem.open;
    vi.spyOn(filesystem, 'open').mockImplementation(async (filePath, ...args) => {
      if (String(filePath).endsWith('.sha256')) throw new Error('private diagnostic');
      return originalOpen(filePath, ...args);
    });
    await expect(writeChecksums(directory)).rejects.toMatchObject({
      code: 'checksum_write_failed',
    });
    expect(await readdir(directory)).toHaveLength(3);
  });

  it('rejects oversized checksum input', async () => {
    await writeChecksums(directory);
    await truncate(path.join(directory, 'SHA256SUMS'), 1025);
    await expect(verifyChecksums(directory)).rejects.toBeInstanceOf(ReleaseError);
  });

  it.each([...names, ...names.map((name) => `${name}.sha256`), 'SHA256SUMS'])(
    'rejects tampered %s',
    async (name) => {
      await writeChecksums(directory);
      await writeFile(path.join(directory, name), 'tampered');
      await expect(verifyChecksums(directory)).rejects.toBeInstanceOf(ReleaseError);
    }
  );

  it('rejects traversal instructions in the checksum manifest', async () => {
    await writeChecksums(directory);
    await writeFile(path.join(directory, 'SHA256SUMS'), `${digest}  ../outside\n`);
    await expect(verifyChecksums(directory)).rejects.toBeInstanceOf(ReleaseError);
  });

  it('rejects extra files at publication verification', async () => {
    await writeChecksums(directory);
    await writeFile(path.join(directory, 'extra'), 'x');
    await expect(verifyChecksums(directory)).rejects.toBeInstanceOf(ReleaseError);
  });

  it('rejects symlink checksum files', async () => {
    await writeChecksums(directory);
    await rm(path.join(directory, 'SHA256SUMS'));
    await symlink(path.join(directory, `${names[0]}.sha256`), path.join(directory, 'SHA256SUMS'));
    await expect(verifyChecksums(directory)).rejects.toBeInstanceOf(ReleaseError);
  });

  it('runs checksum and verification CLI successfully', () => {
    for (const operation of ['checksums', 'verify']) {
      const result = spawnSync(process.execPath, [script, operation, directory], {
        encoding: 'utf8',
        timeout: 5000,
      });
      expect(result.status, result.stderr).toBe(0);
    }
  });

  it('redacts paths on operational CLI failure', () => {
    const result = spawnSync(
      process.execPath,
      [script, 'verify', path.join(directory, 'sensitive-value')],
      { encoding: 'utf8', timeout: 5000 }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('sensitive-value');
    expect(result.stderr).toContain('release');
  });
});

describe('release CLI', () => {
  it.each([[], ['unknown'], ['validate', 'extra'], ['checksums'], ['verify']])(
    'returns usage exit 2 for %j',
    (...argv: string[]) => {
      const result = spawnSync(process.execPath, [script, ...argv], {
        encoding: 'utf8',
        timeout: 5000,
      });
      expect(result.status).toBe(2);
    }
  );

  it('validates RELEASE_TAG against the repository version', async () => {
    const version: string = JSON.parse(await readFile('package.json', 'utf8')).version;
    const result = spawnSync(process.execPath, [script, 'validate'], {
      env: { ...process.env, RELEASE_TAG: `v${version}` },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it('fails closed on missing RELEASE_TAG', () => {
    const result = spawnSync(process.execPath, [script, 'validate'], {
      env: { ...process.env, RELEASE_TAG: '' },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(1);
  });
});

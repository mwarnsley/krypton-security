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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

type WorkflowRecord = Record<string, unknown>;

const asRecord = (value: unknown, label: string): WorkflowRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record`);
  }
  return value as WorkflowRecord;
};

const getRecord = (record: WorkflowRecord, key: string): WorkflowRecord =>
  asRecord(record[key], key);

const getArray = (record: WorkflowRecord, key: string): unknown[] => {
  const value = record[key];
  if (!Array.isArray(value)) throw new TypeError(`${key} must be an array`);
  return value;
};

const getString = (record: WorkflowRecord, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string') throw new TypeError(`${key} must be a string`);
  return value;
};

const parseWorkflow = (relativePath: string): WorkflowRecord => {
  const result = spawnSync(
    'ruby',
    ['-rjson', '-ryaml', '-e', 'print JSON.generate(YAML.load_file(ARGV.fetch(0)))', relativePath],
    { encoding: 'utf8', timeout: 5000 }
  );
  if (result.status !== 0) {
    throw new Error(`Unable to parse ${relativePath}: ${result.stderr}`);
  }
  return asRecord(JSON.parse(result.stdout), relativePath);
};

const getSteps = (job: WorkflowRecord): WorkflowRecord[] =>
  getArray(job, 'steps').map((step, index) => asRecord(step, `step ${index}`));

const getStep = (job: WorkflowRecord, name: string): WorkflowRecord => {
  const step = getSteps(job).find((candidate) => candidate.name === name);
  if (!step) throw new Error(`Missing workflow step: ${name}`);
  return step;
};

const collectUses = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(collectUses);
  if (typeof value !== 'object' || value === null) return [];

  return Object.entries(value).flatMap(([key, child]) => [
    ...(key === 'uses' && typeof child === 'string' ? [child] : []),
    ...collectUses(child),
  ]);
};

describe('release workflow contract', () => {
  let ci: WorkflowRecord;
  let release: WorkflowRecord;
  let ciJobs: WorkflowRecord;
  let releaseJobs: WorkflowRecord;

  beforeAll(() => {
    ci = parseWorkflow('.github/workflows/ci.yml');
    release = parseWorkflow('.github/workflows/release.yml');
    ciJobs = getRecord(ci, 'jobs');
    releaseJobs = getRecord(release, 'jobs');
  });

  it('keeps reusable CI verification while moving bundle assembly into release', () => {
    const verify = getRecord(ciJobs, 'verify');
    expect(verify.name).toBe('Phase 1 verification');

    const ciCommands = getSteps(verify)
      .map((step) => (typeof step.run === 'string' ? step.run : ''))
      .join('\n');
    expect(ciCommands).not.toContain('npm run build:mcpb');
    expect(ciCommands).not.toContain('unzip -t');
    expect(collectUses(verify).some((use) => use.startsWith('actions/upload-artifact@'))).toBe(
      false
    );

    const bundle = getRecord(releaseJobs, 'bundle');
    expect(bundle.needs).toEqual(['verification', 'native']);
    expect(bundle['runs-on']).toBe('macos-14');

    expect(getRecord(getStep(bundle, 'Check out tagged source'), 'with').ref).toBe(
      '${{ github.sha }}'
    );
    expect(getStep(bundle, 'Install dependencies reproducibly').run).toBe('npm ci');
    expect(getRecord(getStep(bundle, 'Download native release binaries'), 'with')).toMatchObject({
      pattern: 'krypton-native-*',
      path: 'dist/native',
      'merge-multiple': true,
    });
    expect(getStep(bundle, 'Assemble standalone MCP bundle').run).toBe('npm run build:mcpb');

    const verification = getString(
      getStep(bundle, 'Verify bundle integrity and embedded binaries'),
      'run'
    );
    expect(verification).toContain('unzip -t "$bundle"');
    expect(verification).toContain(
      'cmp "$verification_dir/native/krypton-core-native-aarch64-apple-darwin" "dist/native/krypton-core-native-aarch64-apple-darwin"'
    );
    expect(verification).toContain(
      'cmp "$verification_dir/native/krypton-core-native-x86_64-apple-darwin" "dist/native/krypton-core-native-x86_64-apple-darwin"'
    );
    expect(getRecord(getStep(bundle, 'Retain standalone MCP bundle'), 'with')).toMatchObject({
      name: 'krypton-mcpb',
      path: 'dist/krypton-protected-fs.mcpb',
      'if-no-files-found': 'error',
    });
  });

  it('runs the packaged bundle on both supported host architectures', () => {
    const packagedE2e = getRecord(releaseJobs, 'packaged_e2e');
    expect(packagedE2e.needs).toBe('bundle');
    expect(packagedE2e['runs-on']).toBe('${{ matrix.runner }}');
    expect(packagedE2e['timeout-minutes']).toBe(20);

    const matrix = getRecord(getRecord(packagedE2e, 'strategy'), 'matrix');
    expect(matrix.include).toEqual([
      { runner: 'macos-14', architecture: 'arm64' },
      { runner: 'macos-15-intel', architecture: 'x86_64' },
    ]);
    expect(getRecord(getStep(packagedE2e, 'Check out tagged source'), 'with').ref).toBe(
      '${{ github.sha }}'
    );
    expect(getStep(packagedE2e, 'Install dependencies reproducibly').run).toBe('npm ci');
    expect(getRecord(getStep(packagedE2e, 'Download assembled MCP bundle'), 'with')).toMatchObject({
      name: 'krypton-mcpb',
      path: 'release-artifacts',
    });
    expect(getStep(packagedE2e, 'Verify packaged MCP bundle end to end')).toMatchObject({
      run: 'npm run test:mcpb -- release-artifacts/krypton-protected-fs.mcpb',
      'timeout-minutes': 10,
    });
  });

  it('gates the draft on the assembled and architecture-tested artifact contract', () => {
    const draft = getRecord(releaseJobs, 'draft');
    expect(draft.needs).toEqual(['verification', 'native', 'bundle', 'packaged_e2e']);
    expect(getRecord(draft, 'permissions')).toEqual({ contents: 'write' });

    const releaseCommand = getString(
      getStep(draft, 'Create draft release without replacing existing releases'),
      'run'
    );
    for (const name of [...names, ...names.map((name) => `${name}.sha256`), 'SHA256SUMS']) {
      expect(releaseCommand).toContain(`release-artifacts/${name}`);
    }
    expect(releaseCommand).toContain('gh api "repos/$GH_REPO/commits/$RELEASE_TAG" --jq .sha');
    expect(releaseCommand).toContain("echo 'Release tag moved after verification.' >&2");
    expect(releaseCommand).toContain('standalone');
    expect(releaseCommand).toContain('bundled native daemon');
    expect(releaseCommand).toContain('unsigned and unnotarized');
    expect(releaseCommand).toContain('built-in Claude tools are outside');
    expect(releaseCommand).toContain('does not include the Next.js dashboard');
    expect(releaseCommand).toContain('live Claude Desktop QA');
  });

  it('keeps all actions pinned and grants write access only to the draft job', () => {
    for (const use of [...collectUses(ci), ...collectUses(release)]) {
      expect(use.startsWith('./') || /^[^@\s]+@[0-9a-f]{40}$/.test(use), use).toBe(true);
    }

    expect(getRecord(ci, 'permissions')).toEqual({ contents: 'read' });
    expect(getRecord(release, 'permissions')).toEqual({ contents: 'read' });
    for (const [jobName, value] of Object.entries(releaseJobs)) {
      const job = asRecord(value, jobName);
      const permissions = job.permissions;
      if (jobName === 'draft') {
        expect(permissions).toEqual({ contents: 'write' });
      } else if (permissions !== undefined) {
        expect(asRecord(permissions, `${jobName}.permissions`).contents).not.toBe('write');
      }
    }
  });
});

describe('strict release tag validation', () => {
  it('accepts a strict ASCII SemVer at 128 characters and rejects 129', () => {
    const exact = `1.0.0+${'a'.repeat(122)}`;
    expect(exact).toHaveLength(128);
    expect(validateReleaseTag(`v${exact}`, exact)).toBe(exact);
    const oversized = `${exact}a`;
    expect(() => validateReleaseTag(`v${oversized}`, oversized)).toThrowError(ReleaseError);
  });
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

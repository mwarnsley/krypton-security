import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  prepareStandaloneRuntime,
  resolveProtectedWorkspace,
  StandaloneRuntimeError,
  type StandaloneRuntimeOptions,
} from '../../src/packaging/mcpb_runtime.cjs';

let root: string;
let temporaryRoot: string;
let options: StandaloneRuntimeOptions;
const names = {
  arm64: 'native/krypton-core-native-aarch64-apple-darwin',
  x64: 'native/krypton-core-native-x86_64-apple-darwin',
};
function binary(cpu: number, marker = 0): Buffer {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf);
  bytes.writeUInt32LE(cpu, 4);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(marker, 28);
  return bytes;
}
async function bundle(marker = 0) {
  const binaries = {} as Record<string, { path: string; size: number; sha256: string }>;
  for (const [arch, cpu] of [
    ['arm64', 0x0100000c],
    ['x64', 0x01000007],
  ] as const) {
    const data = binary(cpu, marker);
    await fs.writeFile(path.join(options.bundleRoot, names[arch]), data);
    binaries[arch] = {
      path: names[arch],
      size: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    };
  }
  await fs.writeFile(
    path.join(options.bundleRoot, 'native/native-binaries.json'),
    JSON.stringify({ schemaVersion: 1, binaries })
  );
}
async function changeMetadata(
  mutate: (value: {
    schemaVersion: number;
    binaries: Record<'arm64' | 'x64', { path: string; size: number; sha256: string }>;
  }) => void
) {
  const file = path.join(options.bundleRoot, 'native/native-binaries.json');
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  mutate(value);
  await fs.writeFile(file, JSON.stringify(value));
}
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'krypton-runtime-test-')));
  const temporaryBase =
    process.platform === 'darwin' ? path.join(path.parse(os.tmpdir()).root, 'tmp') : os.tmpdir();
  temporaryRoot = await fs.realpath(await fs.mkdtemp(path.join(temporaryBase, 'ks-test-')));
  options = {
    bundleRoot: path.join(root, 'bundle'),
    version: '1.0.0',
    platform: 'darwin',
    arch: 'arm64',
    homeDirectory: path.join(root, 'home'),
    temporaryDirectory: temporaryRoot,
    applicationSupportRoot: path.join(root, 'private'),
    configuredWorkspace: path.join(root, 'workspace'),
  };
  await fs.mkdir(path.join(options.bundleRoot, 'native'), { recursive: true });
  await fs.mkdir(options.homeDirectory, { mode: 0o700 });
  await fs.mkdir(options.configuredWorkspace!, { mode: 0o700 });
  await bundle();
}, 30000);
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) {
    await fs.rm(root, { recursive: true, force: true });
  }
  if (temporaryRoot) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}, 30000);

describe('workspace resolution', () => {
  it.each([undefined, '', ' \t\n', '\u2003\u00a0', '\u0085'])(
    'uses the exact private fallback for %j',
    async (value) => {
      const resolved = await resolveProtectedWorkspace(value, options.applicationSupportRoot!);
      expect(resolved).toEqual({
        path: path.join(root, 'private/sandbox_workspace'),
        usedFallback: true,
      });
      expect((await fs.stat(resolved.path)).mode & 0o777).toBe(0o700);
    }
  );
  it.each([
    '${user_config.protected_workspace_root}',
    ' \t${user_config.protected_workspace_root}\n',
    ' ${user_config.protected_workspace_root} ',
  ])('treats the unexpanded host reference %j as the private fallback', async (value) => {
    const resolved = await resolveProtectedWorkspace(value, options.applicationSupportRoot!);
    expect(resolved).toEqual({
      path: path.join(root, 'private/sandbox_workspace'),
      usedFallback: true,
    });
  });
  it.each([
    null,
    12,
    'missing',
    '${user_config.other_root}',
    '${user_config.protected_workspace_root',
    '${user_config.protected_workspace_root}/nested',
    '/tmp/${user_config.protected_workspace_root}',
    '$' + '{user_config.protected_workspace_root}}',
  ])('rejects invalid nonblank input %j', async (value) => {
    await expect(
      resolveProtectedWorkspace(value, options.applicationSupportRoot!)
    ).rejects.toMatchObject({ code: 'invalid_workspace' });
  });
  it('does not create a missing selected workspace', async () => {
    const missing = path.join(root, 'missing');
    await expect(
      resolveProtectedWorkspace(missing, options.applicationSupportRoot!)
    ).rejects.toMatchObject({ code: 'invalid_workspace' });
    await expect(fs.lstat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['symlink', 'file', 'inaccessible'])('rejects a selected %s', async (kind) => {
    const target = path.join(root, 'selected');
    if (kind === 'symlink') await fs.symlink(options.configuredWorkspace!, target);
    else if (kind === 'file') await fs.writeFile(target, 'data');
    else await fs.mkdir(target, { mode: 0 });
    await expect(
      resolveProtectedWorkspace(target, options.applicationSupportRoot!)
    ).rejects.toMatchObject({ code: 'invalid_workspace' });
    if (kind === 'inaccessible') await fs.chmod(target, 0o700);
  });
  it('canonicalizes parent aliases into one workspace ID', async () => {
    const first = await prepareStandaloneRuntime(options);
    await fs.symlink(root, path.join(root, 'alias'));
    const second = await prepareStandaloneRuntime({
      ...options,
      configuredWorkspace: path.join(root, 'alias/workspace'),
    });
    expect(first.workspaceId).toMatch(/^[0-9a-f]{64}$/);
    expect(second.workspaceId).toBe(first.workspaceId);
  });
  it('keeps distinct Unicode directories separate', async () => {
    const first = await prepareStandaloneRuntime(options);
    const selected = path.join(root, '工作区');
    await fs.mkdir(selected);
    const second = await prepareStandaloneRuntime({ ...options, configuredWorkspace: selected });
    expect(second.workspaceId).not.toBe(first.workspaceId);
  });
});

describe('private installed state', () => {
  it('accepts a strict ASCII SemVer at 128 characters and rejects 129', async () => {
    const exact = `1.0.0+${'a'.repeat(122)}`;
    expect(exact).toHaveLength(128);
    await expect(prepareStandaloneRuntime({ ...options, version: exact })).resolves.toMatchObject({
      daemonPath: expect.stringContaining(`/bin/${exact}/arm64/`),
    });
    await expect(
      prepareStandaloneRuntime({ ...options, version: `${exact}a` })
    ).rejects.toMatchObject({ code: 'input_invalid' });
  });
  it('publishes private configuration with the native standalone schema', async () => {
    const result = await prepareStandaloneRuntime(options);
    expect(JSON.parse(await fs.readFile(result.configPath, 'utf8'))).toEqual({
      schemaVersion: 1,
      protectedWorkspaceRoot: options.configuredWorkspace,
      runtimeDirectory: result.runtimeDirectory,
      telemetryPath: result.telemetryPath,
      ignoredPaths: ['node_modules', '.git', '.krypton'],
      telemetryMaxEvents: 10000,
      telemetryMaxBytes: 8388608,
      rateLimitWindowSeconds: 10,
      rateLimitMaxBreakouts: 3,
    });
    expect((await fs.stat(result.configPath)).mode & 0o7777).toBe(0o600);
    expect(result.runtimeHome).toBe(
      path.join(
        temporaryRoot,
        'k',
        Buffer.from(result.workspaceId, 'hex').toString('base64url').slice(0, 12)
      )
    );
  });
  it('keeps all created directories private and all instance files contained', async () => {
    const result = await prepareStandaloneRuntime(options);
    for (const dir of [
      'private',
      'private/bin',
      'private/bin/1.0.0',
      'private/bin/1.0.0/arm64',
      'private/instances',
      `private/instances/${result.workspaceId}`,
      `private/instances/${result.workspaceId}/config`,
      `private/instances/${result.workspaceId}/.krypton`,
      `private/instances/${result.workspaceId}/.krypton/telemetry`,
    ]) {
      expect((await fs.stat(path.join(root, dir))).mode & 0o7777).toBe(0o700);
    }
    for (const directory of [
      path.join(temporaryRoot, 'k'),
      result.runtimeHome,
      path.join(result.runtimeHome, '.krypton'),
      result.runtimeDirectory,
    ]) {
      expect((await fs.stat(directory)).mode & 0o7777).toBe(0o700);
    }
    for (const file of [result.configPath, result.telemetryPath]) {
      expect(file.startsWith(path.join(root, 'private/instances', result.workspaceId) + '/')).toBe(
        true
      );
      expect(file).not.toContain('/workspace');
    }
  });
  it('uses the exact default Application Support layout', async () => {
    const defaults = { ...options };
    delete defaults.applicationSupportRoot;
    delete defaults.configuredWorkspace;
    const result = await prepareStandaloneRuntime(defaults);
    expect(result.protectedWorkspaceRoot).toBe(
      path.join(
        options.homeDirectory,
        'Library/Application Support/KryptonSecurity/sandbox_workspace'
      )
    );
  });
  it.each(['symlink', 'permissions', 'file', 'foreign'])(
    'rejects unsafe root %s without repair',
    async (kind) => {
      const target = options.applicationSupportRoot!;
      if (kind === 'symlink') await fs.symlink(options.homeDirectory, target);
      else if (kind === 'file') await fs.writeFile(target, 'unchanged');
      else await fs.mkdir(target, { mode: kind === 'permissions' ? 0o755 : 0o700 });
      if (kind === 'foreign') {
        const lstat = fs.lstat.bind(fs);
        vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
          const stat = await lstat(...args);
          if (args[0] === target)
            Object.defineProperty(stat, 'uid', { value: process.getuid!() + 1 });
          return stat;
        });
      }
      await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
        code: 'unsafe_state',
      });
      if (kind === 'permissions') expect((await fs.stat(target)).mode & 0o777).toBe(0o755);
    }
  );
  it('rejects redirected intermediate private components', async () => {
    await fs.mkdir(options.applicationSupportRoot!, { mode: 0o700 });
    await fs.symlink(
      options.homeDirectory,
      path.join(options.applicationSupportRoot!, 'instances')
    );
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({ code: 'unsafe_state' });
  });
  it('rejects an instance beneath the protected root', async () => {
    await expect(
      prepareStandaloneRuntime({ ...options, configuredWorkspace: root })
    ).rejects.toMatchObject({ code: 'unsafe_state' });
  });
  it.each(['permissions', 'symlink', 'hardlink', 'directory', 'foreign'])(
    'rejects an unsafe persistent instance lock %s without repair',
    async (kind) => {
      const result = await prepareStandaloneRuntime(options);
      const lock = path.join(
        path.dirname(path.dirname(result.configPath)),
        '.krypton/instance.lock'
      );
      const target = path.join(root, 'lock-target');
      await fs.writeFile(target, 'unchanged', { mode: 0o600 });
      if (kind === 'symlink') await fs.symlink(target, lock);
      else if (kind === 'hardlink') await fs.link(target, lock);
      else if (kind === 'directory') await fs.mkdir(lock, { mode: 0o700 });
      else {
        await fs.writeFile(lock, 'unchanged', { mode: kind === 'permissions' ? 0o644 : 0o600 });
      }
      const before = await fs.lstat(lock);
      if (kind === 'foreign') {
        const lstat = fs.lstat.bind(fs);
        vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
          const stat = await lstat(...args);
          if (args[0] === lock)
            Object.defineProperty(stat, 'uid', { value: process.getuid!() + 1 });
          return stat;
        });
      }
      await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
        code: 'unsafe_state',
      });
      expect(await fs.readFile(target, 'utf8')).toBe('unchanged');
      const after = await fs.lstat(lock);
      expect(after.ino).toBe(before.ino);
      expect(after.mode).toBe(before.mode);
    }
  );
  it('preserves a private persistent lock across different temporary runtime homes', async () => {
    const first = await prepareStandaloneRuntime(options);
    const lock = path.join(path.dirname(path.dirname(first.configPath)), '.krypton/instance.lock');
    await fs.writeFile(lock, 'unchanged', { mode: 0o600 });
    const before = await fs.lstat(lock);
    const otherTemporaryRoot = path.join(temporaryRoot, 'other');
    await fs.mkdir(otherTemporaryRoot, { mode: 0o700 });
    const second = await prepareStandaloneRuntime({
      ...options,
      temporaryDirectory: otherTemporaryRoot,
    });
    expect(second.runtimeHome).not.toBe(first.runtimeHome);
    expect(second.telemetryPath).toBe(first.telemetryPath);
    expect((await fs.lstat(lock)).ino).toBe(before.ino);
    expect(await fs.readFile(lock, 'utf8')).toBe('unchanged');
  });
  it.each(['config', 'telemetry', 'capability'])(
    'rejects unsafe existing %s files',
    async (kind) => {
      const result = await prepareStandaloneRuntime(options);
      const target =
        kind === 'config'
          ? result.configPath
          : kind === 'telemetry'
            ? result.telemetryPath
            : path.join(result.runtimeDirectory, 'capability');
      await fs.writeFile(target, 'unsafe');
      await fs.chmod(target, 0o644);
      await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
        code: 'unsafe_state',
      });
    }
  );
});

describe('verified native publication', () => {
  it.each([
    ['arm64', 0x0100000c],
    ['x64', 0x01000007],
  ] as const)('selects and privately publishes %s', async (arch, cpu) => {
    const result = await prepareStandaloneRuntime({ ...options, arch });
    expect(await fs.readFile(result.daemonPath)).toEqual(binary(cpu));
    expect((await fs.stat(result.daemonPath)).mode & 0o7777).toBe(0o700);
  });
  it.each([{ platform: 'linux' as const }, { arch: 'ia32' }])(
    'rejects unsupported hosts before state creation',
    async (host) => {
      await expect(prepareStandaloneRuntime({ ...options, ...host })).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
      await expect(fs.lstat(options.applicationSupportRoot!)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  );
  it('reuses an unchanged verified executable', async () => {
    const first = await prepareStandaloneRuntime(options);
    const before = await fs.stat(first.daemonPath);
    await prepareStandaloneRuntime(options);
    expect((await fs.stat(first.daemonPath)).ino).toBe(before.ino);
  });
  it.each(['wrong_cpu', 'digest', 'size', 'escaping', 'duplicate', 'schema', 'oversize'])(
    'rejects %s metadata or bytes',
    async (kind) => {
      if (kind === 'wrong_cpu') {
        await fs.writeFile(path.join(options.bundleRoot, names.arm64), binary(0x01000007));
        await changeMetadata((v) => {
          v.binaries.arm64.sha256 = createHash('sha256').update(binary(0x01000007)).digest('hex');
        });
      } else if (kind === 'digest')
        await fs.writeFile(path.join(options.bundleRoot, names.arm64), binary(0x0100000c, 1));
      else
        await changeMetadata((v) => {
          if (kind === 'size') v.binaries.arm64.size = 33;
          if (kind === 'escaping') v.binaries.arm64.path = '../outside';
          if (kind === 'duplicate') v.binaries.x64.path = v.binaries.arm64.path;
          if (kind === 'schema') v.schemaVersion = 2;
          if (kind === 'oversize') v.binaries.arm64.size = 128 * 1024 * 1024 + 1;
        });
      await expect(prepareStandaloneRuntime(options)).rejects.toBeInstanceOf(
        StandaloneRuntimeError
      );
      await expect(
        fs.lstat(path.join(root, 'private/bin/1.0.0/arm64/krypton-core-native'))
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );
  it.each(['native/native-binaries.json', names.arm64, 'native'])(
    'rejects redirected bundle input %s',
    async (relative) => {
      const target = path.join(options.bundleRoot, relative);
      await fs.rename(target, target + '-real');
      await fs.symlink(target + '-real', target);
      await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
        code: 'invalid_binary',
      });
    }
  );
  it('rejects bytes changed while the binary descriptor is open', async () => {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (file === path.join(options.bundleRoot, names.arm64)) {
        const stat = handle.stat.bind(handle);
        let calls = 0;
        vi.spyOn(handle, 'stat').mockImplementation(
          async (...args: Parameters<typeof handle.stat>) => {
            const value = await stat(...args);
            if (++calls > 1) Object.defineProperty(value, 'size', { value: 33 });
            return value;
          }
        );
      }
      return handle;
    });
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
      code: 'invalid_binary',
    });
  });
  it('preserves the previous binary on pre-rename failure and removes staging', async () => {
    const first = await prepareStandaloneRuntime(options);
    const previous = await fs.readFile(first.daemonPath);
    await bundle(1);
    vi.spyOn(fs, 'rename').mockRejectedValue(new Error('private path must not escape'));
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
      code: 'output_failed',
      message: 'output_failed',
    });
    expect(await fs.readFile(first.daemonPath)).toEqual(previous);
    expect(await fs.readdir(path.dirname(first.daemonPath))).toEqual(['krypton-core-native']);
  });
  it('reports uncertain durability after publication without rollback', async () => {
    const first = await prepareStandaloneRuntime(options);
    await bundle(1);
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (file === path.dirname(first.daemonPath))
        handle.sync = async () => {
          throw new Error('private sync failure');
        };
      return handle;
    });
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
      code: 'durability_unknown',
    });
    expect(await fs.readFile(first.daemonPath)).toEqual(binary(0x0100000c, 1));
  });
});

describe('publication and bounded-read failure ownership', () => {
  it('preserves the previous config when its rename fails', async () => {
    const result = await prepareStandaloneRuntime(options);
    await fs.writeFile(result.configPath, '{"previous":true}', { mode: 0o600 });
    vi.spyOn(fs, 'rename').mockRejectedValue(new Error('secret filename'));
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
      code: 'output_failed',
    });
    expect(await fs.readFile(result.configPath, 'utf8')).toBe('{"previous":true}');
    expect(await fs.readdir(path.dirname(result.configPath))).toEqual(['runtime.json']);
  });
  it('reports config durability uncertainty after rename', async () => {
    const result = await prepareStandaloneRuntime(options);
    await fs.writeFile(result.configPath, '{}');
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (file === path.dirname(result.configPath))
        handle.sync = async () => {
          throw new Error('private failure');
        };
      return handle;
    });
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
      code: 'durability_unknown',
    });
    expect(JSON.parse(await fs.readFile(result.configPath, 'utf8')).schemaVersion).toBe(1);
  });
  it('reports staging cleanup failure without exposing its cause', async () => {
    await prepareStandaloneRuntime(options);
    await bundle(1);
    vi.spyOn(fs, 'rename').mockRejectedValue(new Error(root));
    vi.spyOn(fs, 'unlink').mockRejectedValue(new Error(root));
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
      code: 'cleanup_failed',
      message: 'cleanup_failed',
    });
  });
  it('owns failures to inspect a newly created staging descriptor', async () => {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (String(file).includes('.krypton-stage-'))
        vi.spyOn(handle, 'stat').mockRejectedValue(new Error('private failure'));
      return handle;
    });
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
      code: 'cleanup_failed',
    });
  });
  it('rejects an oversized actual binary before reading its bytes', async () => {
    await fs.truncate(path.join(options.bundleRoot, names.arm64), 128 * 1024 * 1024 + 1);
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({ code: 'size_limit' });
  });
  it('rejects oversized metadata before parsing', async () => {
    await fs.writeFile(
      path.join(options.bundleRoot, 'native/native-binaries.json'),
      ' '.repeat(16385)
    );
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({ code: 'size_limit' });
  });
  it('rejects a replaced binary path despite an unchanged open descriptor', async () => {
    const source = path.join(options.bundleRoot, names.arm64);
    const lstat = fs.lstat.bind(fs);
    let reads = 0;
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
      const stat = await lstat(...args);
      if (args[0] === source && ++reads > 1)
        Object.defineProperty(stat, 'ino', { value: Number(stat.ino) + 1 });
      return stat;
    });
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
      code: 'invalid_binary',
    });
  });
  it('rejects private executable symlinks without modifying the target', async () => {
    const result = await prepareStandaloneRuntime(options);
    await fs.unlink(result.daemonPath);
    await fs.symlink(path.join(options.bundleRoot, names.arm64), result.daemonPath);
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({ code: 'unsafe_state' });
    expect(await fs.readFile(path.join(options.bundleRoot, names.arm64))).toEqual(
      binary(0x0100000c)
    );
  });
  it('rechecks private ancestor identities before returning unchanged files', async () => {
    const result = await prepareStandaloneRuntime(options);
    const open = fs.open.bind(fs);
    let replaced = false;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (!replaced && file === result.daemonPath) {
        replaced = true;
        const parent = path.dirname(result.daemonPath);
        await fs.rename(parent, parent + '-old');
        await fs.mkdir(parent, { mode: 0o700 });
        await fs.copyFile(path.join(parent + '-old', 'krypton-core-native'), result.daemonPath);
      }
      return handle;
    });
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({ code: 'unsafe_state' });
  });
});

it('bounds even blank workspace input before interpreting it', async () => {
  await expect(
    resolveProtectedWorkspace(' '.repeat(4097), options.applicationSupportRoot!)
  ).rejects.toMatchObject({ code: 'invalid_workspace' });
});

it('requires no-follow flags for every regular input and publication reopen', async () => {
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
    if (typeof flags !== 'number' || (flags & fs.constants.O_NOFOLLOW) === 0)
      throw new Error('unsafe open');
    return open(file, flags, mode);
  });
  const result = await prepareStandaloneRuntime(options);
  expect((await fs.stat(result.daemonPath)).mode & 0o7777).toBe(0o700);
});

it('preserves the previous binary when staging sync fails', async () => {
  const result = await prepareStandaloneRuntime(options);
  await bundle(1);
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
    const handle = await open(file, flags, mode);
    if (String(file).includes('.krypton-stage-'))
      handle.sync = async () => {
        throw new Error('private failure');
      };
    return handle;
  });
  await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({ code: 'output_failed' });
  expect(await fs.readFile(result.daemonPath)).toEqual(binary(0x0100000c));
  expect(await fs.readdir(path.dirname(result.daemonPath))).toEqual(['krypton-core-native']);
});

it('accepts normal 0755 trusted Application Support parents without repairing them', async () => {
  const parents = path.join(options.homeDirectory, 'Library/Application Support');
  await fs.mkdir(parents, { recursive: true, mode: 0o755 });
  const defaults = { ...options };
  delete defaults.applicationSupportRoot;
  await prepareStandaloneRuntime(defaults);
  expect((await fs.stat(parents)).mode & 0o777).toBe(0o755);
});

describe('short ephemeral socket state', () => {
  it('binds and connects to the returned default macOS socket path', async () => {
    const defaults = { ...options };
    delete defaults.temporaryDirectory;
    const runtimeToken = createHash('sha256')
      .update(options.configuredWorkspace!)
      .digest('base64url')
      .slice(0, 12);
    const ownedHome = path.join(await fs.realpath(os.tmpdir()), 'k', runtimeToken);
    // The workspace fixture is unique; never remove a pre-existing runtime home.
    await expect(fs.lstat(ownedHome)).rejects.toMatchObject({ code: 'ENOENT' });
    const server = net.createServer((socket) => socket.end('ok'));
    let client: net.Socket | undefined;
    try {
      const result = await prepareStandaloneRuntime(defaults);
      const endpoint = path.join(result.runtimeDirectory, 'daemon.sock');
      expect(Buffer.byteLength(endpoint)).toBeLessThanOrEqual(103);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(endpoint, resolve);
      });
      const response = await new Promise<string>((resolve, reject) => {
        client = net.createConnection(endpoint);
        client.setTimeout(1500, () => {
          client?.destroy(new Error('socket timeout'));
        });
        client.once('error', reject);
        client.once('data', (bytes) => resolve(bytes.toString()));
      });
      expect(response).toBe('ok');
    } finally {
      client?.destroy();
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      await fs.rm(ownedHome, { recursive: true, force: true });
    }
  });
  it('fails closed on a full-workspace marker collision without overwriting it', async () => {
    const first = await prepareStandaloneRuntime(options);
    const marker = path.join(first.runtimeHome, 'workspace-id');
    await fs.writeFile(marker, '0'.repeat(64) + '\n', { mode: 0o600 });
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({ code: 'unsafe_state' });
    expect(await fs.readFile(marker, 'utf8')).toBe('0'.repeat(64) + '\n');
  });
  it('publishes and reuses the private full-identity marker', async () => {
    const first = await prepareStandaloneRuntime(options);
    const marker = path.join(first.runtimeHome, 'workspace-id');
    const before = await fs.stat(marker);
    await prepareStandaloneRuntime(options);
    expect(await fs.readFile(marker, 'utf8')).toBe(first.workspaceId + '\n');
    expect(before.mode & 0o7777).toBe(0o600);
    expect((await fs.stat(marker)).ino).toBe(before.ino);
  });
  it('rejects a runtime token directory with no identity marker', async () => {
    const result = await prepareStandaloneRuntime(options);
    await fs.unlink(path.join(result.runtimeHome, 'workspace-id'));
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({ code: 'unsafe_state' });
  });
  it('rejects an overlong temporary root before publication', async () => {
    const longRoot = path.join(temporaryRoot, 'x'.repeat(80));
    await fs.mkdir(longRoot);
    await expect(
      prepareStandaloneRuntime({ ...options, temporaryDirectory: longRoot })
    ).rejects.toMatchObject({ code: 'unsafe_state' });
    await expect(fs.lstat(path.join(root, 'private/bin'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('rejects a symlink at the ephemeral k root', async () => {
    await fs.symlink(options.homeDirectory, path.join(temporaryRoot, 'k'));
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({ code: 'unsafe_state' });
  });
  it('reports lost cleanup authority after the actual staging parent is renamed', async () => {
    const originalOpen = fs.open.bind(fs);
    const originalRename = fs.rename.bind(fs);
    let movedParent: string | undefined;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await originalOpen(file, flags, mode);
      if (String(file).includes('.krypton-stage-')) {
        handle.sync = async () => {
          const parent = path.dirname(String(file));
          movedParent = parent + '-moved';
          await originalRename(parent, movedParent);
          throw new Error('injected write failure');
        };
      }
      return handle;
    });
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
      code: 'cleanup_failed',
    });
    expect(
      (await fs.readdir(movedParent!)).some((name) => name.startsWith('.krypton-stage-'))
    ).toBe(true);
  });
});

it('does not mistake an ancestor lost during leaf cleanup for an absent staging file', async () => {
  const originalOpen = fs.open.bind(fs);
  const originalLstat = fs.lstat.bind(fs);
  let stagingPath: string | undefined;
  vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
    const handle = await originalOpen(file, flags, mode);
    if (String(file).includes('.krypton-stage-')) {
      stagingPath = String(file);
      handle.sync = async () => {
        throw new Error('injected staging failure');
      };
    }
    return handle;
  });
  vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
    if (args[0] === stagingPath) {
      const parent = path.dirname(stagingPath!);
      await fs.rename(parent, parent + '-moved');
      stagingPath = undefined;
    }
    return originalLstat(...args);
  });
  await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({ code: 'cleanup_failed' });
});

describe('concurrent cold-start preparation', () => {
  const daemonPath = () =>
    path.join(options.applicationSupportRoot!, 'bin/1.0.0/arm64/krypton-core-native');
  // A sibling launch's atomic publication of the given bytes at a private leaf.
  async function siblingPublishes(file: string, bytes: Buffer, mode: number) {
    const staged = file + '.sibling';
    await fs.writeFile(staged, bytes, { mode });
    await fs.chmod(staged, mode);
    await fs.rename(staged, file);
  }
  it('prepares identical private state for simultaneous cold launches', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => prepareStandaloneRuntime(options))
    );
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    expect(await fs.readdir(path.dirname(results[0]!.daemonPath))).toEqual(['krypton-core-native']);
  });
  it('adopts identical bytes a sibling publishes before the no-replace link', async () => {
    const link = fs.link.bind(fs);
    vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
      if (destination === daemonPath())
        await siblingPublishes(daemonPath(), binary(0x0100000c), 0o700);
      return link(source, destination);
    });
    const result = await prepareStandaloneRuntime(options);
    expect(await fs.readFile(result.daemonPath)).toEqual(binary(0x0100000c));
    expect(await fs.readdir(path.dirname(result.daemonPath))).toEqual(['krypton-core-native']);
  });
  it('rejects differing bytes a sibling publishes before the no-replace link', async () => {
    const link = fs.link.bind(fs);
    vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
      if (destination === daemonPath())
        await siblingPublishes(daemonPath(), binary(0x0100000c, 7), 0o700);
      return link(source, destination);
    });
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
      code: 'unsafe_state',
    });
    expect(await fs.readFile(daemonPath())).toEqual(binary(0x0100000c, 7));
    expect(await fs.readdir(path.dirname(daemonPath()))).toEqual(['krypton-core-native']);
  });
  it('waits for a sibling link to settle to one hard link', async () => {
    const first = await prepareStandaloneRuntime(options);
    const extra = path.join(path.dirname(first.daemonPath), '.krypton-stage-sibling');
    await fs.link(first.daemonPath, extra);
    setTimeout(() => void fs.unlink(extra), 100);
    await expect(prepareStandaloneRuntime(options)).resolves.toEqual(first);
  });
  it('still rejects a destination that never settles to one hard link', async () => {
    const first = await prepareStandaloneRuntime(options);
    await fs.link(first.daemonPath, path.join(path.dirname(first.daemonPath), 'extra-link'));
    await expect(prepareStandaloneRuntime(options)).rejects.toMatchObject({
      code: 'unsafe_state',
    });
  });
  it('waits for a sibling that created the runtime home to link its marker', async () => {
    const first = await prepareStandaloneRuntime(options);
    const marker = path.join(first.runtimeHome, 'workspace-id');
    await fs.unlink(marker);
    setTimeout(
      () => void siblingPublishes(marker, Buffer.from(first.workspaceId + '\n'), 0o600),
      100
    );
    await expect(prepareStandaloneRuntime(options)).resolves.toEqual(first);
  });
});

describe('source CLI native binary', { timeout: 30000 }, () => {
  it('prepares a source build without an extracted bundle', async () => {
    const nativeBinaryPath = path.join(root, 'source-daemon');
    const bytes = binary(0x0100000c);
    await fs.writeFile(nativeBinaryPath, bytes);
    await fs.rm(options.bundleRoot, { recursive: true });
    const prepared = await prepareStandaloneRuntime({ ...options, nativeBinaryPath });
    expect(await fs.readFile(prepared.daemonPath)).toEqual(bytes);
  });
  it.each(['missing', 'short', 'wrong-arch', 'symlink'] as const)(
    'rejects a %s source build',
    async (mode) => {
      const nativeBinaryPath = path.join(root, 'source-daemon');
      if (mode === 'symlink')
        await fs.symlink(path.join(options.bundleRoot, names.arm64), nativeBinaryPath);
      else if (mode !== 'missing')
        await fs.writeFile(
          nativeBinaryPath,
          mode === 'short' ? Buffer.alloc(4) : binary(0x01000007)
        );
      await expect(
        prepareStandaloneRuntime({ ...options, nativeBinaryPath })
      ).rejects.toMatchObject({ code: 'invalid_binary' });
    }
  );
});

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildBundle, createManifest } from '../../src/packaging/build_mcpb.cjs';

let root: string;
let extracted: string;
let nativeInputs: { arm64: string; x64: string };
const nativeNames = {
  arm64: 'native/krypton-core-native-aarch64-apple-darwin',
  x64: 'native/krypton-core-native-x86_64-apple-darwin',
};

function macho(cpu: number, size = 32): Buffer {
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpu, 4);
  bytes.writeUInt32LE(2, 12);
  return bytes;
}

function archiveFile(name: string): Buffer {
  return execFileSync('unzip', ['-p', artifact.path, name], { timeout: 5000 });
}

function buildFixture() {
  return buildBundle(root, { nativeInputs });
}
let artifact: Awaited<ReturnType<typeof buildBundle>>;
const sourceFiles = [
  'src/core/mcp/server.cjs',
  'src/core/processIsolation.cjs',
  'src/core/supervisor.cjs',
  'src/cli/runtime.cjs',
  'src/packaging/launch_mcpb.cjs',
  'src/packaging/mcpb_runtime.cjs',
  'package.json',
  'package-lock.json',
  'LICENSE',
];

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'krypton-bundle-test-')));
  for (const file of sourceFiles) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.copyFile(path.resolve(file), path.join(root, file));
  }
  for (const name of [
    'ajv',
    'fast-uri',
    'fast-deep-equal',
    'json-schema-traverse',
    'require-from-string',
  ]) {
    await fs.cp(path.resolve('node_modules', name), path.join(root, 'node_modules', name), {
      recursive: true,
    });
  }
  await fs.mkdir(path.join(root, '.krypton'), { recursive: true });
  await fs.writeFile(path.join(root, '.krypton', 'secret'), 'must-not-be-bundled');
  await fs.mkdir(path.join(root, 'input-binaries'));
  nativeInputs = {
    arm64: path.join(root, 'input-binaries', 'arm64'),
    x64: path.join(root, 'input-binaries', 'x64'),
  };
  await fs.writeFile(nativeInputs.arm64, macho(0x0100000c));
  await fs.writeFile(nativeInputs.x64, macho(0x01000007));
  artifact = await buildFixture();
  // Sibling temporary roots prevent Node from falling back to the fixture's
  // installed dependencies when an archive dependency is accidentally omitted.
  extracted = await fs.mkdtemp(path.join(os.tmpdir(), 'krypton-bundle-extracted-'));
  execFileSync('unzip', ['-q', artifact.path, '-d', extracted], { timeout: 5000 });
});

afterAll(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
  if (extracted) await fs.rm(extracted, { recursive: true, force: true });
});

describe('MCPB build', () => {
  it.each(['', 'latest', '01.0.0', '1.2', '../secret'])(
    'rejects invalid package version %s',
    (version) => {
      expect(() => createManifest(version)).toThrow('input_invalid');
    }
  );
  it('accepts a strict ASCII SemVer at 128 characters and rejects 129', () => {
    const exact = `1.0.0+${'a'.repeat(122)}`;
    expect(exact).toHaveLength(128);
    expect(createManifest(exact).version).toBe(exact);
    expect(() => createManifest(`${exact}a`)).toThrow('input_invalid');
  });
  it('declares the current package version and both native file tools', () => {
    const manifest = createManifest('1.2.3');
    expect(manifest).toMatchObject({
      manifest_version: '0.3',
      name: 'krypton-protected-fs',
      display_name: 'Krypton Protected Filesystem',
      version: '1.2.3',
      description: 'Deterministic, native-enforced filesystem containment engine for AI agents.',
      server: { type: 'node', entry_point: 'src/packaging/launch_mcpb.cjs' },
    });
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      'krypton_read_file',
      'krypton_write_file',
    ]);
  });

  it('requests a workspace directory without embedding the build host path', () => {
    const manifest = createManifest('1.0.0');
    expect(manifest.user_config).toEqual({
      protected_workspace_root: expect.objectContaining({ type: 'directory', required: false }),
    });
    expect(manifest.server.mcp_config.env).toEqual({
      KRYPTON_PROTECTED_WORKSPACE_ROOT: '${user_config.protected_workspace_root}',
    });
    expect(manifest.compatibility).toEqual({
      platforms: ['darwin'],
      runtimes: { node: '>=20.19.4' },
    });
  });

  it('produces byte-identical archives after timestamps change', async () => {
    const original = await fs.readFile(artifact.path);
    await fs.utimes(path.join(root, 'src/core/mcp/server.cjs'), 1234567890, 1234567890);
    const repeated = await buildFixture();
    expect(await fs.readFile(repeated.path)).toEqual(original);
    expect(repeated.sha256).toBe(artifact.sha256);
  });

  it('excludes development dependencies, tests, source maps and runtime state', () => {
    const names = execFileSync('unzip', ['-Z1', artifact.path], {
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(names).not.toMatch(/\.krypton|vitest|dashboard|\.map\n|\/test\/|\/spec\//);
    expect(names).toContain('node_modules/ajv/dist/refs/json-schema-2020-12/schema.json');
    expect(names.split('\n')).toEqual(
      expect.arrayContaining(['src/packaging/launch_mcpb.cjs', 'src/packaging/mcpb_runtime.cjs'])
    );
    expect(names).not.toContain('src/core/supervisor.cjs');
  });

  it('loads bundled dependencies and lists tools without checkout module resolution', () => {
    const result = spawnSync(process.execPath, [path.join(extracted, 'src/core/mcp/server.cjs')], {
      cwd: extracted,
      env: { PATH: process.env.PATH, KRYPTON_PROJECT_ROOT: extracted },
      input:
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'bundle-test', version: '1' },
          },
        }) +
        '\n' +
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) +
        '\n' +
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) +
        '\n',
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 16384,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('krypton_write_file');
  });

  it('loads the entire standalone launcher closure without checkout resolution', () => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        "require('./src/packaging/launch_mcpb.cjs'); require('./src/packaging/mcpb_runtime.cjs')",
      ],
      {
        cwd: extracted,
        env: { PATH: process.env.PATH },
        encoding: 'utf8',
        timeout: 5000,
      }
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('publishes exactly the reviewed native inventory with digests of archive bytes', () => {
    const names = execFileSync('unzip', ['-Z1', artifact.path], { encoding: 'utf8' });
    expect(names.split('\n').filter((name) => name.startsWith('native/'))).toEqual([
      nativeNames.arm64,
      nativeNames.x64,
      'native/native-binaries.json',
    ]);
    const arm64 = archiveFile(nativeNames.arm64);
    const x64 = archiveFile(nativeNames.x64);
    expect(JSON.parse(archiveFile('native/native-binaries.json').toString())).toEqual({
      schemaVersion: 1,
      binaries: {
        arm64: {
          path: nativeNames.arm64,
          size: 32,
          sha256: createHash('sha256').update(arm64).digest('hex'),
        },
        x64: {
          path: nativeNames.x64,
          size: 32,
          sha256: createHash('sha256').update(x64).digest('hex'),
        },
      },
    });
    expect([arm64, x64]).toEqual([macho(0x0100000c), macho(0x01000007)]);
  });

  it('embeds standalone installation guidance without builder or checkout configuration', () => {
    const readme = archiveFile('README.md').toString();
    expect(readme).toContain('~/Library/Application Support/KryptonSecurity/sandbox_workspace');
    expect(readme).toMatch(/exactly two Krypton file tools/i);
    expect(readme).toMatch(/automatically/);
    expect(readme).toMatch(/telemetry.*Application Support/s);
    expect(readme).toMatch(/no checkout or Rust toolchain/i);
    expect(readme).toMatch(/unsigned and not notarized/i);
    expect(readme).toMatch(/does not intercept.*built-in/s);
    expect(readme).toMatch(/no bundled dashboard/i);
    expect(archiveFile('manifest.json').toString()).not.toMatch(/project_root|checkout/);
  });

  it('does not leak absolute builder or explicit input paths into archive bytes', async () => {
    const bytes = await fs.readFile(artifact.path);
    expect(bytes.includes(Buffer.from(root))).toBe(false);
    expect(bytes.includes(Buffer.from(nativeInputs.arm64))).toBe(false);
  });

  it('resolves explicit relative native inputs against the project root', async () => {
    const result = await buildBundle(root, {
      nativeInputs: { arm64: 'input-binaries/arm64', x64: 'input-binaries/x64' },
    });
    expect(result.sha256).toBe(artifact.sha256);
  });

  it('uses the two default dist/native release paths when no override is supplied', async () => {
    await fs.mkdir(path.join(root, 'dist/native'), { recursive: true });
    await fs.copyFile(nativeInputs.arm64, path.join(root, 'dist', nativeNames.arm64));
    await fs.copyFile(nativeInputs.x64, path.join(root, 'dist', nativeNames.x64));
    try {
      expect((await buildBundle(root)).sha256).toBe(artifact.sha256);
    } finally {
      await fs.rm(path.join(root, 'dist/native'), { recursive: true });
    }
  });

  it.each([
    ['missing', 'input_invalid'],
    ['empty', 'invalid_binary'],
    ['directory', 'unsafe_input'],
    ['symlink', 'unsafe_input'],
    ['redirected', 'unsafe_input'],
    ['oversized', 'size_limit'],
    ['wrong-cpu', 'invalid_binary'],
    ['wrong-magic', 'invalid_binary'],
    ['truncated', 'invalid_binary'],
    ['non-executable', 'invalid_binary'],
  ])('rejects %s native input without replacing the previous artifact', async (kind, code) => {
    const folder = await fs.mkdtemp(path.join(root, 'bad-native-'));
    let input = path.join(folder, 'binary');
    if (kind === 'directory') await fs.mkdir(input);
    else if (kind === 'symlink') await fs.symlink(nativeInputs.arm64, input);
    else if (kind === 'redirected') {
      await fs.symlink(path.dirname(nativeInputs.arm64), path.join(folder, 'alias'));
      input = path.join(folder, 'alias', 'arm64');
    } else if (kind !== 'missing') {
      let bytes = macho(0x0100000c);
      if (kind === 'empty') bytes = Buffer.alloc(0);
      if (kind === 'wrong-cpu') bytes = macho(0x01000007);
      if (kind === 'non-executable') bytes.writeUInt32LE(6, 12);
      if (kind === 'wrong-magic') bytes.writeUInt32BE(0xfeedfacf, 0);
      if (kind === 'truncated') bytes = bytes.subarray(0, 8);
      await fs.writeFile(input, bytes);
      if (kind === 'oversized') await fs.truncate(input, 128 * 1024 * 1024 + 1);
    }
    const original = await fs.readFile(artifact.path);
    try {
      await expect(
        buildBundle(root, { nativeInputs: { ...nativeInputs, arm64: input } })
      ).rejects.toMatchObject({ name: 'PackagingError', code, message: code });
      expect(await fs.readFile(artifact.path)).toEqual(original);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it('rejects swapped architectures', async () => {
    await expect(
      buildBundle(root, {
        nativeInputs: { arm64: nativeInputs.x64, x64: nativeInputs.arm64 },
      })
    ).rejects.toMatchObject({ code: 'invalid_binary' });
  });

  it.each(['same-path', 'hard-link'])('rejects duplicate native inputs: %s', async (kind) => {
    const duplicate = path.join(root, 'duplicate-native');
    if (kind === 'hard-link') await fs.link(nativeInputs.arm64, duplicate);
    try {
      await expect(
        buildBundle(root, {
          nativeInputs: {
            arm64: nativeInputs.arm64,
            x64: kind === 'same-path' ? nativeInputs.arm64 : duplicate,
          },
        })
      ).rejects.toMatchObject({ code: 'unsafe_input' });
    } finally {
      if (kind === 'hard-link') await fs.unlink(duplicate);
    }
  });

  it.each(['../escape', '', 'bad\0path', 'x'.repeat(4097), '\ud800'])(
    'rejects malformed native paths (%#)',
    async (input) => {
      await expect(
        buildBundle(root, { nativeInputs: { ...nativeInputs, arm64: input } })
      ).rejects.toMatchObject({ code: 'input_invalid' });
    }
  );

  it.each(['replace-path', 'grow', 'rewrite', 'descriptor-change', 'ancestor-change'])(
    'rejects native inputs changed during read: %s',
    async (kind) => {
      const folder = await fs.mkdtemp(path.join(root, 'mutable-native-'));
      const input = path.join(folder, 'arm64');
      await fs.writeFile(input, macho(0x0100000c));
      const open = fs.open.bind(fs);
      const spy = vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
        const handle = await open(file, flags, mode);
        if (file === input) {
          const read = handle.read.bind(handle);
          let changed = false;
          handle.read = (async (...args: Parameters<typeof read>) => {
            const result = await read(...args);
            if (!changed) {
              changed = true;
              if (kind === 'replace-path') {
                await fs.rename(input, input + '-old');
                await fs.writeFile(input, macho(0x0100000c));
              } else if (kind === 'grow') await fs.appendFile(input, 'x');
              else if (kind === 'rewrite') {
                await fs.writeFile(input, macho(0x0100000c));
                await fs.utimes(input, 1, 1);
              } else if (kind === 'ancestor-change') {
                await fs.rename(folder, folder + '-old');
                await fs.symlink(folder + '-old', folder);
              } else {
                const stat = handle.stat.bind(handle);
                handle.stat = (async () => {
                  const value = await stat({ bigint: true });
                  return Object.assign(value, { ino: value.ino + 1n });
                }) as typeof handle.stat;
              }
            }
            return result;
          }) as typeof handle.read;
        }
        return handle;
      });
      try {
        await expect(
          buildBundle(root, { nativeInputs: { ...nativeInputs, arm64: input } })
        ).rejects.toMatchObject({ code: 'unsafe_input' });
      } finally {
        spy.mockRestore();
        await fs.rm(folder, { recursive: true, force: true });
        await fs.rm(folder + '-old', { recursive: true, force: true });
      }
    }
  );

  it('reads native data in bounded no-follow chunks', async () => {
    const input = path.join(root, 'large-native');
    const bytes = macho(0x0100000c, 1024 * 1024 + 1);
    await fs.writeFile(input, bytes);
    const open = fs.open.bind(fs);
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      if (file === input && (typeof flags !== 'number' || !(flags & constants.O_NOFOLLOW)))
        throw new Error('Native input must be opened without following links');
      const handle = await open(file, flags, mode);
      if (file === input) {
        const read = handle.read.bind(handle);
        handle.read = (async (
          buffer: Buffer,
          offset: number,
          length: number,
          position: number | null
        ) => {
          if (length > 65536) throw new Error('Native reads must be bounded chunks');
          return read(buffer, offset, length, position);
        }) as typeof handle.read;
      }
      return handle;
    });
    try {
      const result = await buildBundle(root, { nativeInputs: { ...nativeInputs, arm64: input } });
      expect(
        execFileSync('unzip', ['-p', result.path, nativeNames.arm64], {
          maxBuffer: 2 * 1024 * 1024,
        })
      ).toEqual(bytes);
    } finally {
      spy.mockRestore();
      await fs.unlink(input);
      await buildFixture();
    }
  });

  it('preserves an existing artifact when a required input is missing', async () => {
    const original = await fs.readFile(artifact.path);
    const source = path.join(root, 'LICENSE');
    const bytes = await fs.readFile(source);
    await fs.unlink(source);
    try {
      await expect(buildFixture()).rejects.toMatchObject({ code: 'input_invalid' });
      expect(await fs.readFile(artifact.path)).toEqual(original);
    } finally {
      await fs.writeFile(source, bytes);
    }
  });

  it('rejects source symlinks without packaging their contents', async () => {
    const source = path.join(root, 'LICENSE');
    const bytes = await fs.readFile(source);
    await fs.unlink(source);
    await fs.symlink(path.join(root, '.krypton/secret'), source);
    try {
      await expect(buildFixture()).rejects.toMatchObject({ code: 'unsafe_input' });
    } finally {
      await fs.unlink(source);
      await fs.writeFile(source, bytes);
    }
  });

  it('rejects installed dependencies that disagree with the lockfile', async () => {
    const file = path.join(root, 'node_modules/ajv/package.json');
    const original = await fs.readFile(file);
    await fs.writeFile(
      file,
      JSON.stringify({ ...JSON.parse(original.toString()), version: '0.0.0' })
    );
    try {
      await expect(buildFixture()).rejects.toMatchObject({ code: 'dependency_invalid' });
    } finally {
      await fs.writeFile(file, original);
    }
  });

  it('refuses an output directory symlink', async () => {
    const directory = path.join(root, 'dist');
    await fs.rename(directory, directory + '-saved');
    await fs.symlink(extracted, directory);
    try {
      await expect(buildFixture()).rejects.toMatchObject({ code: 'unsafe_input' });
    } finally {
      await fs.unlink(directory);
      await fs.rename(directory + '-saved', directory);
    }
  });

  it('preserves the old archive when atomic rename fails', async () => {
    const original = await fs.readFile(artifact.path);
    const rename = vi.spyOn(fs, 'rename').mockRejectedValue(new Error('fixture rename failure'));
    try {
      await expect(buildFixture()).rejects.toMatchObject({ code: 'output_failed' });
      expect(await fs.readFile(artifact.path)).toEqual(original);
      expect(
        (await fs.readdir(path.join(root, 'dist'))).filter((name) => name.startsWith('.mcpb-'))
      ).toEqual([]);
    } finally {
      rename.mockRestore();
    }
  });

  it.each([false, true])(
    'preserves publication uncertainty when cleanup also fails: %s',
    async (failCleanup) => {
      const open = fs.open.bind(fs);
      const remove = fs.rm.bind(fs);
      const openSpy = vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
        const handle = await open(file, flags, mode);
        if (file === path.join(root, 'dist'))
          handle.sync = async () => {
            throw new Error('fixture sync failure');
          };
        return handle;
      });
      const cleanup = vi.spyOn(fs, 'rm').mockImplementation(async (file, options) => {
        if (failCleanup && String(file).includes('.mcpb-'))
          throw new Error('fixture cleanup failure');
        return remove(file, options);
      });
      try {
        await expect(buildFixture()).rejects.toMatchObject({ code: 'durability_unknown' });
      } finally {
        openSpy.mockRestore();
        cleanup.mockRestore();
        for (const name of await fs.readdir(path.join(root, 'dist'))) {
          if (name.startsWith('.mcpb-'))
            await fs.rm(path.join(root, 'dist', name), { recursive: true });
        }
      }
    }
  );
});

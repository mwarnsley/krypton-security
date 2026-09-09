import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildBundle, createManifest } from '../../src/packaging/build_mcpb.cjs';

let root: string;
let extracted: string;
let artifact: Awaited<ReturnType<typeof buildBundle>>;
const sourceFiles = [
  'src/core/mcp/server.cjs',
  'src/core/processIsolation.cjs',
  'src/core/supervisor.cjs',
  'src/cli/runtime.cjs',
  'src/packaging/launch_mcpb.cjs',
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
  artifact = await buildBundle(root);
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
  it('declares the current package version and both native file tools', () => {
    const manifest = createManifest('1.2.3');
    expect(manifest).toMatchObject({
      manifest_version: '0.3',
      name: 'krypton-protected-fs',
      display_name: 'Krypton Protected Filesystem',
      version: '1.2.3',
      description: 'Deterministic, native-enforced filesystem containment engine for AI agents.',
      server: { type: 'node', entry_point: 'src/core/mcp/server.cjs' },
    });
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      'krypton_read_file',
      'krypton_write_file',
    ]);
  });

  it('requests a workspace directory without embedding the build host path', () => {
    const manifest = createManifest('1.0.0');
    expect(manifest.user_config.project_root).toMatchObject({ type: 'directory', required: true });
    expect(manifest.server.mcp_config.env.KRYPTON_PROJECT_ROOT).toBe('${user_config.project_root}');
    expect(JSON.stringify(manifest)).not.toContain(root);
  });

  it('produces byte-identical archives after timestamps change', async () => {
    const original = await fs.readFile(artifact.path);
    await fs.utimes(path.join(root, 'src/core/mcp/server.cjs'), 1234567890, 1234567890);
    const repeated = await buildBundle(root);
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
    expect(names).toContain('src/packaging/launch_mcpb.cjs');
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

  it('fails the portable launcher closed when no configured daemon is available', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(extracted, 'src/packaging/launch_mcpb.cjs')],
      {
        cwd: extracted,
        env: { PATH: process.env.PATH, KRYPTON_PROJECT_ROOT: extracted },
        encoding: 'utf8',
        timeout: 5000,
      }
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[KRYPTON]');
  });

  it('preserves an existing artifact when a required input is missing', async () => {
    const original = await fs.readFile(artifact.path);
    const source = path.join(root, 'LICENSE');
    const bytes = await fs.readFile(source);
    await fs.unlink(source);
    try {
      await expect(buildBundle(root)).rejects.toMatchObject({ code: 'input_invalid' });
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
      await expect(buildBundle(root)).rejects.toMatchObject({ code: 'unsafe_input' });
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
      await expect(buildBundle(root)).rejects.toMatchObject({ code: 'dependency_invalid' });
    } finally {
      await fs.writeFile(file, original);
    }
  });

  it('refuses an output directory symlink', async () => {
    const directory = path.join(root, 'dist');
    await fs.rename(directory, directory + '-saved');
    await fs.symlink(extracted, directory);
    try {
      await expect(buildBundle(root)).rejects.toMatchObject({ code: 'unsafe_input' });
    } finally {
      await fs.unlink(directory);
      await fs.rename(directory + '-saved', directory);
    }
  });

  it('preserves the old archive when atomic rename fails', async () => {
    const original = await fs.readFile(artifact.path);
    const rename = vi.spyOn(fs, 'rename').mockRejectedValue(new Error('fixture rename failure'));
    try {
      await expect(buildBundle(root)).rejects.toMatchObject({ code: 'output_failed' });
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
        await expect(buildBundle(root)).rejects.toMatchObject({ code: 'durability_unknown' });
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

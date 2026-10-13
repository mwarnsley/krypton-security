import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createZip } from '../../src/packaging/zip.cjs';
import { createManifest } from '../../src/packaging/build_mcpb.cjs';
import { runPackagedMcpbE2E } from '../../src/testing/mcpb_e2e.cjs';
import type { PackagedE2EDependencies } from '../../src/testing/mcpb_e2e.cjs';
import type { Socket } from 'node:net';

const runtimeFiles = [
  'LICENSE',
  'src/cli/runtime.cjs',
  'src/core/processIsolation.cjs',
  'src/core/mcp/server.cjs',
  'src/packaging/launch_mcpb.cjs',
  'src/packaging/mcpb_runtime.cjs',
];
const receipt = {
  tool: 'krypton_read_file',
  path: '../outside.txt',
  action: 'denied',
  telemetry: 'queued',
  id: 'native-mcp-0123456789abcdef',
  capturedAt: '2026-10-12T12:00:00.000Z',
};
const event = {
  sequence: 1,
  id: receipt.id,
  capturedAt: receipt.capturedAt,
  severity: 'high',
  category: 'mcp_boundary',
  path: '../outside.txt',
  attribution: 'unattributed',
  source: 'native',
  details: { tool: 'krypton_read_file', action: 'denied' },
};
let root: string;
let archive: string;
let entries: { name: string; data: Buffer }[];
let removed: string[];
let report: ReturnType<typeof vi.fn<(message: string) => void>>;
let launchCount: number;
let behavior: string;
let launchOptions: SpawnOptions[];
let active: boolean;
let timer: ReturnType<typeof setTimeout> | undefined;

function binary(cpu: number) {
  const data = Buffer.alloc(32);
  data.writeUInt32LE(0xfeedfacf);
  data.writeUInt32LE(cpu, 4);
  data.writeUInt32LE(2, 12);
  return data;
}
function child() {
  const result = new EventEmitter() as ChildProcess;
  result.stdout = new PassThrough();
  result.stderr = new PassThrough();
  result.stdin = new PassThrough();
  Object.defineProperty(result, 'exitCode', { value: null, writable: true });
  Object.defineProperty(result, 'signalCode', { value: null, writable: true });
  const close = (code: number | null = 0, signal: NodeJS.Signals | null = null) => {
    if (result.exitCode !== null || result.signalCode !== null) return;
    Object.defineProperty(result, 'exitCode', { value: code });
    Object.defineProperty(result, 'signalCode', { value: signal });
    result.stdout?.emit('end');
    result.stderr?.emit('end');
    result.emit('exit', code, signal);
    result.emit('close', code, signal);
  };
  result.kill = (signal) => {
    close(null, signal as NodeJS.Signals);
    return true;
  };
  return { result, close };
}
function dependencies(): PackagedE2EDependencies {
  return {
    platform: 'darwin',
    arch: 'arm64',
    temporaryDirectory: root,
    report,
    fs: {
      ...fs,
      rm: async (target, options) => {
        removed.push(String(target));
        await fs.rm(target, options);
      },
    },
    connect: () => {
      const socket = new EventEmitter() as Socket;
      socket.destroy = () => socket;
      queueMicrotask(() => {
        if (active || behavior === 'socket_live') socket.emit('connect');
        else socket.emit('error', Object.assign(new Error('closed'), { code: 'ENOENT' }));
      });
      return socket;
    },
    spawn: (command, args, options) => {
      const { result, close } = child();
      if (command === '/usr/bin/unzip') {
        expect(options.shell).toBe(false);
        expect(args.slice(0, 1)).toEqual(['-q']);
        const destination = args[args.indexOf('-d') + 1]!;
        void (async () => {
          for (const entry of entries) {
            await fs.mkdir(path.dirname(path.join(destination, entry.name)), { recursive: true });
            await fs.writeFile(path.join(destination, entry.name), entry.data);
          }
          if (behavior === 'extract_extra')
            await fs.writeFile(path.join(destination, 'surprise'), 'bad');
          if (behavior === 'extract_output') result.stdout?.emit('data', Buffer.alloc(65537));
          if (behavior === 'extract_changed') await fs.appendFile(archive, 'mutation');
          if (behavior !== 'extract_stall') close();
        })().catch((error: unknown) => result.emit('error', error));
        return result;
      }
      launchCount++;
      launchOptions.push(options);
      active = true;
      expect(command).toBe(process.execPath);
      expect(args).toEqual([
        path.join(path.dirname(String(options.env?.HOME)), 'bundle/src/packaging/launch_mcpb.cjs'),
      ]);
      const home = String(options.env?.HOME);
      const support = path.join(home, 'Library/Application Support/KryptonSecurity');
      const workspace =
        options.env?.KRYPTON_PROTECTED_WORKSPACE_ROOT?.trim() ||
        path.join(support, 'sandbox_workspace');
      const instance = path.join(
        support,
        'instances',
        createHash('sha256').update(workspace).digest('hex')
      );
      const runtimeDirectory = path.join(
        String(options.env?.TMPDIR),
        'daemon',
        String(launchCount)
      );
      const ledger = path.join(instance, '.krypton/telemetry/alerts.jsonl');
      let initialized = false;
      let received = '';
      result.stdin = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          received += chunk.toString();
          const lines = received.split('\n');
          received = lines.pop()!;
          void (async () => {
            for (const line of lines) {
              const request = JSON.parse(line);
              if (request.method === 'notifications/initialized') {
                initialized = true;
                continue;
              }
              let response;
              if (request.method === 'initialize') {
                await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
                await fs.mkdir(path.dirname(ledger), { recursive: true });
                await fs.mkdir(path.join(instance, 'config'), { recursive: true });
                await fs.mkdir(runtimeDirectory, { recursive: true });
                await fs.writeFile(
                  path.join(instance, 'config/runtime.json'),
                  JSON.stringify({
                    schemaVersion: 1,
                    protectedWorkspaceRoot: workspace,
                    runtimeDirectory,
                    telemetryPath: ledger,
                  })
                );
                response = {
                  protocolVersion: '2025-11-25',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'krypton-protected-fs', version: '1.0.0' },
                };
              } else {
                expect(initialized).toBe(true);
                if (request.params.arguments.path === '../outside.txt') {
                  response = {
                    isError: true,
                    content: [
                      {
                        type: 'text',
                        text: JSON.stringify({
                          code: 'file_access_denied',
                          receipt:
                            behavior === 'bad_receipt'
                              ? { ...receipt, action: 'allowed' }
                              : receipt,
                        }),
                      },
                    ],
                  };
                  await fs.writeFile(
                    ledger,
                    JSON.stringify(
                      behavior === 'bad_telemetry' ? { ...event, source: 'mock' } : event
                    ) + '\n'
                  );
                } else {
                  const content = await fs.readFile(
                    path.join(workspace, request.params.arguments.path),
                    'utf8'
                  );
                  response = { isError: false, content: [{ type: 'text', text: content }] };
                }
              }
              if (behavior === 'premature') {
                close(1);
                continue;
              }
              if (behavior === 'stall') continue;
              if (behavior === 'stderr') result.stderr?.emit('data', Buffer.alloc(65537));
              const frame =
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: behavior === 'wrong_id' ? 999 : request.id,
                  result: response,
                }) + '\n';
              result.stdout?.emit(
                'data',
                Buffer.from(
                  behavior === 'malformed'
                    ? 'not-json\n'
                    : behavior === 'frame_large'
                      ? 'a'.repeat(32769)
                      : frame
                )
              );
              if (behavior === 'duplicate') result.stdout?.emit('data', Buffer.from(frame));
            }
            callback();
          })().catch((error: unknown) =>
            callback(error instanceof Error ? error : new Error('fake boundary failure'))
          );
        },
        final(callback) {
          active = false;
          if (behavior === 'late')
            result.stdout?.emit('data', Buffer.from('{"jsonrpc":"2.0","id":1,"result":{}}\n'));
          if (behavior === 'partial') result.stdout?.emit('data', Buffer.from('{'));
          if (behavior !== 'shutdown_stall') close();
          callback();
        },
      });
      return result;
    },
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp('/private/tmp/me-test-');
  archive = path.join(root, 'fixture.mcpb');
  removed = [];
  report = vi.fn();
  launchCount = 0;
  behavior = '';
  launchOptions = [];
  active = false;
  const arm = binary(0x0100000c);
  const x64 = binary(0x01000007);
  const armPath = 'native/krypton-core-native-aarch64-apple-darwin';
  const x64Path = 'native/krypton-core-native-x86_64-apple-darwin';
  entries = [
    ...runtimeFiles.map((name) => ({ name, data: Buffer.from('fixture runtime') })),
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(createManifest('1.0.0'))) },
    {
      name: 'package.json',
      data: Buffer.from('{"name":"krypton-protected-fs","version":"1.0.0","type":"commonjs"}'),
    },
    { name: 'README.md', data: Buffer.from('fixture') },
    { name: armPath, data: arm },
    { name: x64Path, data: x64 },
    {
      name: 'native/native-binaries.json',
      data: Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          binaries: {
            arm64: {
              path: armPath,
              size: arm.length,
              sha256: createHash('sha256').update(arm).digest('hex'),
            },
            x64: {
              path: x64Path,
              size: x64.length,
              sha256: createHash('sha256').update(x64).digest('hex'),
            },
          },
        })
      ),
    },
  ];
  await fs.writeFile(archive, createZip(entries));
});
afterEach(async () => {
  clearTimeout(timer);
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe('packaged MCPB harness', () => {
  it('completes both isolated scenarios and reports only after owned-tree cleanup', async () => {
    report.mockImplementation(() => expect(removed).toHaveLength(1));
    await runPackagedMcpbE2E(archive, dependencies());
    expect(launchCount).toBe(2);
    expect(report.mock.calls.map((call) => call[0])).toEqual([
      '[PASS] Custom workspace.',
      '[PASS] Fallback workspace.',
      '[PASS] Traversal denial.',
      '[PASS] Telemetry durability.',
      '[PASS] Daemon cleanup.',
    ]);
  });
  it('does not inherit checkout or Node runtime injection variables', async () => {
    vi.stubEnv('KRYPTON_PROJECT_ROOT', '/checkout');
    vi.stubEnv('NODE_OPTIONS', '--require /checkout/inject.cjs');
    try {
      await runPackagedMcpbE2E(archive, dependencies());
    } finally {
      vi.unstubAllEnvs();
    }
    expect(launchOptions[0]?.env).not.toHaveProperty('KRYPTON_PROJECT_ROOT');
    expect(launchOptions[0]?.env).not.toHaveProperty('NODE_OPTIONS');
    expect(launchOptions[0]?.cwd).toMatch(/\/cwd$/);
  });
  it.each(['directory', 'symlink', 'oversize', 'redirected'])(
    'rejects %s archives before launching',
    async (kind) => {
      if (kind === 'directory') {
        await fs.unlink(archive);
        await fs.mkdir(archive);
      }
      if (kind === 'symlink') {
        await fs.rename(archive, archive + '.real');
        await fs.symlink(archive + '.real', archive);
      }
      if (kind === 'oversize') await fs.truncate(archive, 261 * 1024 * 1024);
      if (kind === 'redirected') {
        await fs.mkdir(path.join(root, 'actual'));
        await fs.rename(archive, path.join(root, 'actual/fixture.mcpb'));
        await fs.symlink(path.join(root, 'actual'), path.join(root, 'redirect'));
        archive = path.join(root, 'redirect/fixture.mcpb');
      }
      await expect(runPackagedMcpbE2E(archive, dependencies())).rejects.toHaveProperty('code');
      expect(launchCount).toBe(0);
    }
  );
  it.each(['extract_extra', 'extract_changed', 'extract_output'])(
    'rejects %s and cleans only its own tree',
    async (mode) => {
      behavior = mode;
      await expect(runPackagedMcpbE2E(archive, dependencies())).rejects.toHaveProperty('code');
      expect(removed).toEqual([expect.stringMatching(new RegExp(`^${root}/km-[^/]+$`))]);
      expect(report).not.toHaveBeenCalled();
    }
  );
  it.each([
    'wrong_id',
    'duplicate',
    'malformed',
    'frame_large',
    'stderr',
    'premature',
    'late',
    'partial',
    'bad_receipt',
    'bad_telemetry',
    'socket_live',
  ])('fails closed for %s without partial PASS output', async (mode) => {
    behavior = mode;
    await expect(runPackagedMcpbE2E(archive, dependencies())).rejects.toHaveProperty('code');
    expect(report).not.toHaveBeenCalled();
  });
  it.each(['traversal', 'absolute', 'backslash', 'special', 'count', 'unsupported'])(
    'rejects %s archive inventory before extraction',
    async (mode) => {
      const data = await fs.readFile(archive);
      if (['traversal', 'absolute', 'backslash'].includes(mode)) {
        const bad =
          mode === 'traversal' ? '../bad.md' : mode === 'absolute' ? '/badxx.md' : 'bad\\xx.md';
        for (
          let offset = data.indexOf('README.md');
          offset !== -1;
          offset = data.indexOf('README.md', offset + 1)
        )
          data.write(bad, offset, 'utf8');
      } else if (mode === 'special') {
        const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        data.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
      } else if (mode === 'count') {
        data.writeUInt16LE(2049, data.length - 14);
        data.writeUInt16LE(2049, data.length - 12);
      } else data.writeUInt16LE(8, 8);
      await fs.writeFile(archive, data);
      await expect(runPackagedMcpbE2E(archive, dependencies())).rejects.toHaveProperty('code');
      expect(launchCount).toBe(0);
    }
  );
  it.each(['extract_stall', 'stall', 'shutdown_stall'])(
    'bounds %s with an absolute timer and cleans up',
    async (mode) => {
      behavior = mode;
      const deps = dependencies();
      deps.setTimer = (callback, milliseconds) =>
        setTimeout(
          callback,
          (mode === 'extract_stall' && milliseconds === 10000) ||
            (mode === 'stall' && milliseconds === 15000) ||
            (mode === 'shutdown_stall' && milliseconds === 6000)
            ? 50
            : milliseconds
        );
      await expect(runPackagedMcpbE2E(archive, deps)).rejects.toHaveProperty('code');
      expect(report).not.toHaveBeenCalled();
    }
  );
  it.each(['resolve', 'reject'])(
    'total deadline interrupts pre-scenario setup before its late %s and cleans the owned tree',
    async (settlement) => {
      const deps = dependencies();
      let expire: (() => void) | undefined;
      let settle: (() => void) | undefined;
      deps.setTimer = (callback, milliseconds) => {
        if (milliseconds === 45000 && !expire) expire = callback;
        return setTimeout(callback, milliseconds);
      };
      deps.fs = {
        ...deps.fs,
        readdir: ((directory, options) => {
          if (launchCount === 0 && String(directory).endsWith('/home')) {
            const pending = new Promise<Awaited<ReturnType<typeof fs.readdir>>>(
              (resolve, reject) => {
                settle = () =>
                  settlement === 'resolve'
                    ? resolve([])
                    : reject(new Error('late private setup failure'));
              }
            );
            queueMicrotask(() => expire?.());
            return pending;
          }
          return fs.readdir(directory, options as never) as unknown as ReturnType<
            typeof fs.readdir
          >;
        }) as typeof fs.readdir,
      };
      const outcome = runPackagedMcpbE2E(archive, deps).then(
        () => 'resolved',
        (error: unknown) => error
      );
      try {
        const observed = await Promise.race([
          outcome,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve('still pending'), 250);
          }),
        ]);
        expect(observed).toHaveProperty('code', 'operation_timeout');
        expect(removed).toEqual([expect.stringMatching(new RegExp(`^${root}/km-[^/]+$`))]);
      } finally {
        settle?.();
        await outcome;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect({ launches: launchCount, reports: report.mock.calls.length }).toEqual({
        launches: 0,
        reports: 0,
      });
    },
    1000
  );
  it.each(['resolve', 'reject'])(
    'settles a timed-out mkdtemp %s through bounded ownership cleanup',
    async (settlement) => {
      const deps = dependencies();
      let expire: (() => void) | undefined;
      let settle: (() => void) | undefined;
      let signalStarted: (() => void) | undefined;
      let created: string | undefined;
      const started = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });
      deps.setTimer = (callback, milliseconds) => {
        if (milliseconds === 45000 && !expire) expire = callback;
        return setTimeout(callback, milliseconds);
      };
      deps.fs = {
        ...deps.fs,
        mkdtemp: ((prefix, options) => {
          signalStarted?.();
          return new Promise<string>((resolve, reject) => {
            settle = () => {
              if (settlement === 'reject') {
                reject(new Error('late private creation failure'));
                return;
              }
              void fs
                .mkdtemp(prefix, options as BufferEncoding)
                .then((directory) => {
                  created = directory;
                  resolve(directory);
                })
                .catch(reject);
            };
          });
        }) as typeof fs.mkdtemp,
      };
      const outcome = runPackagedMcpbE2E(archive, deps).then(
        () => 'resolved',
        (error: unknown) => error
      );
      await started;
      expire?.();
      settle?.();
      const observed = await outcome;
      expect(observed).toHaveProperty('code', 'operation_timeout');
      if (settlement === 'resolve') {
        expect(created).toMatch(new RegExp(`^${root}/km-[^/]+$`));
        expect(removed).toEqual([created]);
        await expect(fs.lstat(created!)).rejects.toMatchObject({ code: 'ENOENT' });
      } else {
        expect(created).toBeUndefined();
        expect(removed).toHaveLength(0);
      }
      expect({ launches: launchCount, reports: report.mock.calls.length }).toEqual({
        launches: 0,
        reports: 0,
      });
    }
  );
  it.each(['resolve', 'reject'])(
    'bounds an extracted-directory close before its late %s',
    async (settlement) => {
      const deps = dependencies();
      let expire: (() => void) | undefined;
      let settle: (() => void) | undefined;
      let signalClosing: (() => void) | undefined;
      const closing = new Promise<void>((resolve) => {
        signalClosing = resolve;
      });
      deps.setTimer = (callback, milliseconds) => {
        if (milliseconds === 45000 && !expire) expire = callback;
        return setTimeout(callback, milliseconds);
      };
      deps.fs = {
        ...deps.fs,
        opendir: (async (directory, options) => {
          const handle = await fs.opendir(directory, options);
          if (String(directory).endsWith('/bundle')) {
            const close = handle.close.bind(handle);
            handle.close = () => {
              signalClosing?.();
              return new Promise<void>((resolve, reject) => {
                settle = () => {
                  void close().then(() => {
                    if (settlement === 'resolve') resolve();
                    else reject(new Error('late private close failure'));
                  }, reject);
                };
              });
            };
          }
          return handle;
        }) as typeof fs.opendir,
      };
      const outcome = runPackagedMcpbE2E(archive, deps).then(
        () => 'resolved',
        (error: unknown) => error
      );
      await closing;
      expire?.();
      const observed = await outcome;
      expect(observed).toHaveProperty('code', 'operation_timeout');
      expect(removed).toEqual([expect.stringMatching(new RegExp(`^${root}/km-[^/]+$`))]);
      settle?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect({ launches: launchCount, reports: report.mock.calls.length }).toEqual({
        launches: 0,
        reports: 0,
      });
    }
  );
  it('bounds an unresolved mkdtemp cleanup and gives cleanup failure precedence', async () => {
    const deps = dependencies();
    let expire: (() => void) | undefined;
    let signalStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const timers = new Set<ReturnType<typeof setTimeout>>();
    deps.setTimer = (callback, milliseconds) => {
      if (milliseconds === 45000 && !expire) expire = callback;
      const handle = setTimeout(callback, milliseconds === 6000 ? 25 : milliseconds);
      timers.add(handle);
      return handle;
    };
    deps.clearTimer = (handle) => {
      clearTimeout(handle);
      timers.delete(handle);
    };
    deps.fs = {
      ...deps.fs,
      mkdtemp: (() => {
        signalStarted?.();
        return new Promise<string>(() => undefined);
      }) as unknown as typeof fs.mkdtemp,
    };
    const outcome = runPackagedMcpbE2E(archive, deps).then(
      () => 'resolved',
      (error: unknown) => error
    );
    await started;
    expire?.();
    await expect(outcome).resolves.toHaveProperty('code', 'cleanup_failed');
    expect({
      removed: removed.length,
      launches: launchCount,
      reports: report.mock.calls.length,
    }).toEqual({ removed: 0, launches: 0, reports: 0 });
    expect(timers.size).toBe(0);
  });
  it.each(['resolve', 'reject'])(
    'scenario deadline interrupts stalled filesystem work before its late %s',
    async (settlement) => {
      const deps = dependencies();
      let expire: (() => void) | undefined;
      let settle: (() => void) | undefined;
      deps.setTimer = (callback, milliseconds) => {
        if (milliseconds === 15000 && !expire) expire = callback;
        return setTimeout(callback, milliseconds);
      };
      deps.fs = {
        ...deps.fs,
        realpath: ((file) => {
          if (launchCount === 1 && String(file).endsWith('/protected')) {
            const pending = new Promise<string>((resolve, reject) => {
              settle = () =>
                settlement === 'resolve'
                  ? resolve(String(file))
                  : reject(new Error('late private filesystem failure'));
            });
            expire?.();
            return pending;
          }
          return fs.realpath(file);
        }) as typeof fs.realpath,
      };
      const running = runPackagedMcpbE2E(archive, deps);
      const outcome = running.then(
        () => 'resolved',
        (error: unknown) => error
      );
      let observed: unknown;
      try {
        observed = await Promise.race([
          outcome,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve('still pending'), 250);
          }),
        ]);
        expect(observed).toHaveProperty('code', 'scenario_timeout');
        expect(active).toBe(false);
      } finally {
        settle?.();
        await outcome;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect({ launches: launchCount, reports: report.mock.calls.length }).toEqual({
        launches: 1,
        reports: 0,
      });
    }
  );
  it('scenario deadline wins over ENOENT from the final socket probe', async () => {
    const deps = dependencies();
    let expire: (() => void) | undefined;
    deps.setTimer = (callback, milliseconds) => {
      if (milliseconds === 15000 && !expire) expire = callback;
      return setTimeout(callback, milliseconds);
    };
    deps.connect = () => {
      const socket = new EventEmitter() as Socket;
      socket.destroy = () => socket;
      queueMicrotask(() => {
        if (active) socket.emit('connect');
        else {
          expire?.();
          queueMicrotask(() =>
            socket.emit('error', Object.assign(new Error('late close'), { code: 'ENOENT' }))
          );
        }
      });
      return socket;
    };
    await expect(runPackagedMcpbE2E(archive, deps)).rejects.toHaveProperty(
      'code',
      'scenario_timeout'
    );
    expect(report).not.toHaveBeenCalled();
    expect(launchCount).toBe(1);
  });
  it.each([
    ['lstat', 'resolve'],
    ['lstat', 'reject'],
    ['realpath', 'resolve'],
    ['realpath', 'reject'],
  ])(
    'cleanup budget interrupts %s validation before late %s without removing the tree',
    async (operation, settlement) => {
      const deps = dependencies();
      let settle: (() => void) | undefined;
      const isCleanupRoot = (file: unknown) =>
        launchCount === 2 &&
        !active &&
        path.dirname(String(file)) === root &&
        path.basename(String(file)).startsWith('km-');
      const stall = <T>(value: T) =>
        new Promise<T>((resolve, reject) => {
          settle = () =>
            settlement === 'resolve'
              ? resolve(value)
              : reject(new Error('late private validation failure'));
        });
      deps.setTimer = (callback, milliseconds) =>
        setTimeout(callback, milliseconds === 6000 ? 25 : milliseconds);
      deps.fs = {
        ...deps.fs,
        lstat: ((file, options) => {
          const result = options?.bigint ? fs.lstat(file, { bigint: true }) : fs.lstat(file);
          return operation === 'lstat' && isCleanupRoot(file) ? result.then(stall) : result;
        }) as typeof fs.lstat,
        realpath: ((file) => {
          const result = fs.realpath(file);
          return operation === 'realpath' && isCleanupRoot(file) ? result.then(stall) : result;
        }) as typeof fs.realpath,
      };
      const outcome = runPackagedMcpbE2E(archive, deps).then(
        () => 'resolved',
        (error: unknown) => error
      );
      try {
        const observed = await Promise.race([
          outcome,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve('still pending'), 250);
          }),
        ]);
        expect(observed).toHaveProperty('code', 'cleanup_failed');
      } finally {
        settle?.();
        await outcome;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(removed).toHaveLength(0);
      expect(report).not.toHaveBeenCalled();
    }
  );
  it('telemetry budget rejects a matching event whose descriptor closes after two seconds', async () => {
    const deps = dependencies();
    let now = 0;
    let closed = 0;
    deps.now = () => now;
    deps.fs = {
      ...deps.fs,
      open: async (file, flags, mode) => {
        const handle = await fs.open(file, flags, mode);
        if (String(file).endsWith('/alerts.jsonl')) {
          const close = handle.close.bind(handle);
          handle.close = async () => {
            await close();
            closed++;
            now += 2001;
          };
        }
        return handle;
      },
    };
    await expect(runPackagedMcpbE2E(archive, deps)).rejects.toHaveProperty(
      'code',
      'telemetry_invalid'
    );
    expect(closed).toBe(1);
    expect(report).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'])(
    'telemetry budget stops a stalled read and closes the handle after late %s',
    async (settlement) => {
      const deps = dependencies();
      let settle: (() => void) | undefined;
      let reads = 0;
      let closes = 0;
      let signalClosed: (() => void) | undefined;
      const closed = new Promise<void>((resolve) => {
        signalClosed = resolve;
      });
      deps.setTimer = (callback, milliseconds) =>
        setTimeout(callback, milliseconds === 2000 ? 25 : milliseconds);
      deps.fs = {
        ...deps.fs,
        open: async (file, flags, mode) => {
          const handle = await fs.open(file, flags, mode);
          if (String(file).endsWith('/alerts.jsonl')) {
            const close = handle.close.bind(handle);
            handle.close = async () => {
              await close();
              closes++;
              signalClosed?.();
            };
            handle.read = ((buffer: Buffer) => {
              reads++;
              if (reads > 1) return Promise.resolve({ bytesRead: 0, buffer });
              return new Promise<{ bytesRead: number; buffer: Buffer }>((resolve, reject) => {
                settle = () =>
                  settlement === 'resolve'
                    ? resolve({ bytesRead: 0, buffer })
                    : reject(new Error('late private read failure'));
              });
            }) as typeof handle.read;
          }
          return handle;
        },
      };
      const outcome = runPackagedMcpbE2E(archive, deps).then(
        () => 'resolved',
        (error: unknown) => error
      );
      try {
        const observed = await Promise.race([
          outcome,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve('still pending'), 250);
          }),
        ]);
        expect(observed).toHaveProperty('code', 'telemetry_invalid');
      } finally {
        settle?.();
        await outcome;
        await closed;
      }
      expect({ reads, closes, active }).toEqual({ reads: 1, closes: 1, active: false });
      expect(report).not.toHaveBeenCalled();
    }
  );
  it.each(['node_modules/ajv/dist/.env', 'node_modules/ajv/dist/' + 'a/'.repeat(20) + 'file.js'])(
    'rejects unexpected dependency inventory %s',
    async (name) => {
      entries.push({ name, data: Buffer.from('not a packaged runtime file') });
      await fs.writeFile(archive, createZip(entries));
      await expect(runPackagedMcpbE2E(archive, dependencies())).rejects.toHaveProperty('code');
      expect(launchCount).toBe(0);
    }
  );
  it('bounds a stuck filesystem cleanup without printing PASS', async () => {
    const deps = dependencies();
    deps.fs = { ...fs, rm: () => new Promise(() => undefined) };
    deps.setTimer = (callback, milliseconds) =>
      setTimeout(callback, milliseconds === 6000 ? 25 : milliseconds);
    await expect(runPackagedMcpbE2E(archive, deps)).rejects.toHaveProperty(
      'code',
      'cleanup_failed'
    );
    expect(report).not.toHaveBeenCalled();
  }, 1000);
  it.each(['manifest', 'metadata', 'architecture'])(
    'rejects corrupt %s before spawn',
    async (mode) => {
      const file = entries.find(
        (entry) =>
          entry.name ===
          (mode === 'manifest'
            ? 'manifest.json'
            : mode === 'metadata'
              ? 'native/native-binaries.json'
              : 'native/krypton-core-native-aarch64-apple-darwin')
      )!;
      if (mode === 'architecture') {
        file.data.writeUInt32LE(0x01000007, 4);
        const metadataEntry = entries.find(
          (entry) => entry.name === 'native/native-binaries.json'
        )!;
        const metadata = JSON.parse(metadataEntry.data.toString());
        metadata.binaries.arm64.sha256 = createHash('sha256').update(file.data).digest('hex');
        metadataEntry.data = Buffer.from(JSON.stringify(metadata));
      } else {
        const value = JSON.parse(file.data.toString());
        if (mode === 'manifest') value.server.mcp_config.command = '/bin/sh';
        else value.binaries.arm64.sha256 = '0'.repeat(64);
        file.data = Buffer.from(JSON.stringify(value));
      }
      await fs.writeFile(archive, createZip(entries));
      await expect(runPackagedMcpbE2E(archive, dependencies())).rejects.toHaveProperty(
        'code',
        'archive_invalid'
      );
      expect(launchCount).toBe(0);
    }
  );
  it('redacts operational CLI failures with exit 1', () => {
    const result = spawnSync(
      process.execPath,
      ['src/testing/mcpb_e2e.cjs', '/private/tmp/missing-private-archive.mcpb'],
      { encoding: 'utf8', timeout: 5000 }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('operation_failed');
    expect(result.stderr).not.toContain('missing-private-archive');
  });
  it('propagates owned cleanup failures without success output', async () => {
    const deps = dependencies();
    deps.fs = {
      ...fs,
      rm: async () => {
        throw new Error('private failure');
      },
    };
    await expect(runPackagedMcpbE2E(archive, deps)).rejects.toHaveProperty(
      'code',
      'cleanup_failed'
    );
    expect(report).not.toHaveBeenCalled();
  });
  it.each([[[]], [['one.mcpb', 'two.mcpb']]])(
    'rejects invalid CLI argument count %j with exit 2',
    (args) => {
      const result = spawnSync(process.execPath, ['src/testing/mcpb_e2e.cjs', ...args], {
        encoding: 'utf8',
        timeout: 5000,
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
    }
  );
});

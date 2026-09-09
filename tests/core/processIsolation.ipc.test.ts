import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchNativeControl } from '../../src/core/processIsolation.cjs';

let root: string;
let runtime: string;
let frame: Record<string, unknown>;
let socket: EventEmitter & {
  setEncoding: ReturnType<typeof vi.fn>;
  setTimeout: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'krypton-ipc-test-'));
  runtime = path.join(root, '.krypton/runtime');
  await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(runtime, 'daemon.json'),
    JSON.stringify({
      protocolVersion: 1,
      endpoint: path.join(runtime, 'daemon.sock'),
      capabilityFile: path.join(runtime, 'capability'),
    }),
    { mode: 0o600 }
  );
  await fs.writeFile(path.join(runtime, 'capability'), 'fake-test-capability', { mode: 0o600 });
  const socketMetadata = Object.assign(await fs.stat(runtime), { isSocket: () => true });
  vi.spyOn(fs, 'lstat').mockResolvedValue(socketMetadata);
  socket = Object.assign(new EventEmitter(), {
    setEncoding: vi.fn(),
    setTimeout: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
  });
  socket.end.mockImplementation((wire: string) => {
    frame = JSON.parse(wire);
  });
  vi.spyOn(net, 'createConnection').mockImplementation(() => {
    queueMicrotask(() => socket.emit('connect'));
    return socket as unknown as net.Socket;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await fs.rm(root, { recursive: true, force: true });
});
async function connected() {
  await vi.waitFor(() => expect(socket.end).toHaveBeenCalled());
}
function reply(overrides: Record<string, unknown> = {}) {
  socket.emit(
    'data',
    JSON.stringify({
      protocolVersion: 1,
      requestId: frame.requestId,
      ok: true,
      code: 'process_registered',
      ...overrides,
    }) + '\n'
  );
  socket.emit('end');
}

describe('native launcher IPC wire', () => {
  it('accepts redundant dot segments and connects using the exact normalized runtime path', async () => {
    await fs.writeFile(
      path.join(runtime, 'daemon.json'),
      JSON.stringify({
        protocolVersion: 1,
        endpoint: `${root}/./.krypton/./runtime/daemon.sock`,
        capabilityFile: `${root}/./.krypton/runtime/./capability`,
      })
    );
    const pending = dispatchNativeControl({ type: 'health' }, root);
    const result = pending.catch((error: unknown) => error);
    await connected();
    reply();
    expect(await result).toMatchObject({ ok: true });
    expect(net.createConnection).toHaveBeenCalledWith(path.join(runtime, 'daemon.sock'));
  });
  it.each(['endpoint', 'capabilityFile'] as const)(
    'rejects invalid discovery field %s before connecting',
    async (field) => {
      for (const value of [
        null,
        42,
        '',
        'relative/path',
        '/elsewhere/file',
        `${runtime}/../outside`,
        `${runtime}/../runtime/${field === 'endpoint' ? 'daemon.sock' : 'capability'}`,
      ]) {
        await fs.writeFile(
          path.join(runtime, 'daemon.json'),
          JSON.stringify({
            protocolVersion: 1,
            endpoint: path.join(runtime, 'daemon.sock'),
            capabilityFile: path.join(runtime, 'capability'),
            [field]: value,
          })
        );
        await expect(dispatchNativeControl({ type: 'health' }, root)).rejects.toThrow(
          'discovery record'
        );
      }
      expect(net.createConnection).not.toHaveBeenCalled();
    }
  );
  it.each(['symlink', 'file'])('rejects a socket %s instead of following it', async (kind) => {
    vi.mocked(fs.lstat).mockRestore();
    if (kind === 'symlink')
      await fs.symlink('/untrusted/socket', path.join(runtime, 'daemon.sock'));
    else await fs.writeFile(path.join(runtime, 'daemon.sock'), 'not a socket');
    await expect(dispatchNativeControl({ type: 'health' }, root)).rejects.toThrow('Unix socket');
    expect(net.createConnection).not.toHaveBeenCalled();
  });
  it('rejects a missing socket before connecting', async () => {
    vi.mocked(fs.lstat).mockRejectedValue(
      Object.assign(new Error('missing socket'), { code: 'ENOENT' })
    );
    await expect(dispatchNativeControl({ type: 'health' }, root)).rejects.toThrow('missing socket');
    expect(net.createConnection).not.toHaveBeenCalled();
  });
  it('rejects a missing capability before connecting', async () => {
    await fs.unlink(path.join(runtime, 'capability'));
    await expect(dispatchNativeControl({ type: 'health' }, root)).rejects.toThrow();
    expect(net.createConnection).not.toHaveBeenCalled();
  });
  it('sends the authenticated nested identity frame with a unique request id', async () => {
    const command = {
      type: 'register_process',
      process: { pid: 4200, startTime: 100, parentPid: 4000, executablePath: '/usr/bin/node' },
    };
    const pending = dispatchNativeControl(command, root);
    await connected();
    reply();
    await pending;
    expect(frame).toEqual({
      protocolVersion: 1,
      requestId: expect.stringMatching(/^req-/),
      capability: 'fake-test-capability',
      command,
    });
    expect(net.createConnection).toHaveBeenCalledWith(path.join(runtime, 'daemon.sock'));
  });
  it.each([{ requestId: 'wrong' }, { protocolVersion: 2 }, { ok: 'true' }, { code: null }])(
    'rejects malformed or mismatched acknowledgment %j',
    async (overrides) => {
      const pending = dispatchNativeControl({ type: 'health' }, root);
      const rejected = expect(pending).rejects.toThrow();
      await connected();
      reply(overrides);
      await rejected;
    }
  );
  it('rejects oversized response frames', async () => {
    const pending = dispatchNativeControl({ type: 'health' }, root);
    const rejected = expect(pending).rejects.toThrow('oversized');
    await connected();
    socket.emit('data', 'x'.repeat(16385));
    await rejected;
  });
  it('uses an absolute deadline even if response data keeps arriving', async () => {
    const pending = dispatchNativeControl({ type: 'health' }, root);
    const rejected = expect(pending).rejects.toThrow('timed out');
    await connected();
    // The actual transport's deadline must fire even without the socket idle event.
    socket.emit('data', ' ');
    await rejected;
    expect(socket.destroy).toHaveBeenCalled();
  });
  it('rejects oversized discovery before connecting', async () => {
    await fs.writeFile(path.join(runtime, 'daemon.json'), ' '.repeat(16385));
    await expect(dispatchNativeControl({ type: 'health' }, root)).rejects.toThrow();
    expect(net.createConnection).not.toHaveBeenCalled();
  });
  it('rejects a publicly readable capability before connecting', async () => {
    await fs.chmod(path.join(runtime, 'capability'), 0o644);
    await expect(dispatchNativeControl({ type: 'health' }, root)).rejects.toThrow();
    expect(net.createConnection).not.toHaveBeenCalled();
  });
});

import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOG_BYTES, SHUTDOWN_GRACE_MS, runDaemonHost } from '../../src/core/daemonHost.cjs';

function fixture() {
  const output: Buffer[] = [];
  const log = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output.push(Buffer.from(chunk));
      callback();
    },
  });
  const child = Object.assign(new EventEmitter(), {
    pid: 62001 as number | undefined,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn().mockReturnValue(true),
    unref: vi.fn(),
  });
  const signals = new EventEmitter();
  const spawn = vi.fn().mockReturnValue(child);
  const createLog = vi.fn().mockReturnValue(log);
  const close = (code = 0) => {
    child.emit('exit', code, null);
    child.emit('close', code, null);
  };
  return { output, child, signals, spawn, createLog, log, close };
}

afterEach(() => vi.useRealTimers());

describe('detached native daemon host', () => {
  it('spawns the supplied binary literally and owns both output streams', async () => {
    const deps = fixture();
    const running = runDaemonHost('/checkout/native daemon', deps);
    deps.close();
    expect(await running).toBe(0);
    expect(deps.spawn).toHaveBeenCalledWith('/checkout/native daemon', [], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it.each([MAX_LOG_BYTES - 1, MAX_LOG_BYTES, MAX_LOG_BYTES + 1])(
    'bounds combined output at the threshold for %i bytes',
    async (size) => {
      const deps = fixture();
      const running = runDaemonHost('/native', deps);
      deps.child.stdout.emit('data', Buffer.alloc(size - 1, 'a'));
      deps.child.stderr.emit('data', Buffer.from('z'));
      deps.close();
      expect(await running).toBe(0);
      expect(Buffer.concat(deps.output).length).toBe(Math.min(size, MAX_LOG_BYTES));
    }
  );

  it('keeps draining after the combined log budget is exhausted', async () => {
    const deps = fixture();
    const running = runDaemonHost('/native', deps);
    deps.child.stderr.emit('data', Buffer.alloc(MAX_LOG_BYTES, 'b'));
    for (let index = 0; index < 100; index++)
      deps.child.stdout.emit('data', Buffer.alloc(8192, 'c'));
    deps.close();
    expect(await running).toBe(0);
    expect(Buffer.concat(deps.output)).toEqual(Buffer.alloc(MAX_LOG_BYTES, 'b'));
  });

  it.each(['', 'relative/native', '/native\0invalid'])(
    'rejects invalid binary %j',
    async (binary) => {
      const deps = fixture();
      expect(await runDaemonHost(binary, deps)).toBe(2);
      expect(deps.spawn).not.toHaveBeenCalled();
    }
  );

  it.each(['SIGTERM', 'SIGINT'] as const)('forwards %s only to its child', async (signal) => {
    const deps = fixture();
    const running = runDaemonHost('/native', deps);
    deps.signals.emit(signal);
    deps.close();
    expect(await running).toBeGreaterThan(0);
    expect(deps.child.kill).toHaveBeenCalledWith(signal);
    expect(deps.signals.listenerCount(signal)).toBe(0);
  });

  it('escalates shutdown and bounds the final reap wait', async () => {
    vi.useFakeTimers();
    const deps = fixture();
    const running = runDaemonHost('/native', deps);
    deps.signals.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS * 2);
    expect(await running).toBe(1);
    expect(deps.child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(deps.child.unref).toHaveBeenCalledOnce();
  });

  it.each(['stdout', 'stderr'] as const)('stops the child on %s errors', async (stream) => {
    const deps = fixture();
    const running = runDaemonHost('/native', deps);
    deps.child[stream].emit('error', new Error('secret path'));
    deps.close();
    expect(await running).toBe(1);
    expect(deps.child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it.each(['uncaughtException', 'unhandledRejection'])('cleans up on %s', async (event) => {
    const deps = fixture();
    const running = runDaemonHost('/native', deps);
    deps.signals.emit(event, new Error('private argument'));
    deps.close();
    expect(await running).toBe(1);
    expect(deps.child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('stops the child on log failure', async () => {
    const deps = fixture();
    const running = runDaemonHost('/native', deps);
    deps.log.emit('error', new Error('private path'));
    deps.close();
    expect(await running).toBe(1);
    expect(deps.child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('bounds a stalled asynchronous log write', async () => {
    vi.useFakeTimers();
    const deps = fixture();
    deps.createLog.mockReturnValue(new Writable({ write() {} }));
    const running = runDaemonHost('/native', deps);
    deps.child.stdout.emit('data', Buffer.from('hello'));
    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS);
    expect(deps.child.kill).toHaveBeenCalledWith('SIGTERM');
    deps.close();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS);
    expect(await running).toBe(1);
  });

  it('returns failure on a synchronous spawn error and closes the log', async () => {
    const deps = fixture();
    deps.spawn.mockImplementation(() => {
      throw new Error('secret argument');
    });
    expect(await runDaemonHost('/native', deps)).toBe(1);
    expect(deps.log.destroyed).toBe(true);
  });

  it('handles asynchronous spawn errors and late error events', async () => {
    const deps = fixture();
    deps.child.pid = undefined;
    const running = runDaemonHost('/native', deps);
    deps.child.emit('error', new Error('ENOENT'));
    deps.close();
    expect(await running).toBe(1);
    expect(() => deps.child.emit('error', new Error('late'))).not.toThrow();
  });

  it('preserves a failing native exit status without restarting', async () => {
    const deps = fixture();
    const running = runDaemonHost('/native', deps);
    deps.close(7);
    expect(await running).toBe(7);
    expect(deps.spawn).toHaveBeenCalledOnce();
  });

  it('refuses to spawn when the log cannot be opened', async () => {
    const deps = fixture();
    deps.createLog.mockImplementation(() => {
      throw new Error('secret path');
    });
    expect(await runDaemonHost('/native', deps)).toBe(1);
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it.each(['false', 'throw'])('bounds cleanup when signaling fails with %s', async (mode) => {
    vi.useFakeTimers();
    const deps = fixture();
    deps.child.kill.mockImplementation(() => {
      if (mode === 'throw') throw new Error('signal failure');
      return false;
    });
    const running = runDaemonHost('/native', deps);
    deps.signals.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS * 2);
    expect(await running).toBe(1);
    expect(deps.child.kill).toHaveBeenCalledTimes(2);
  });

  it('does not extend termination deadlines for repeated errors', async () => {
    vi.useFakeTimers();
    const deps = fixture();
    const running = runDaemonHost('/native', deps);
    deps.child.stdout.emit('error', new Error('first'));
    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS);
    deps.child.stderr.emit('error', new Error('second'));
    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS);
    expect(await running).toBe(1);
    expect(deps.child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
  });

  it('bounds native pipes held open after the owned child exits', async () => {
    vi.useFakeTimers();
    const deps = fixture();
    const running = runDaemonHost('/native', deps);
    deps.child.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS);
    expect(await running).toBe(1);
    expect(deps.child.stdout.destroyed && deps.child.stderr.destroyed).toBe(true);
    expect(deps.child.kill).not.toHaveBeenCalled();
  });

  it('does not send SIGKILL after the owned child exits during shutdown', async () => {
    vi.useFakeTimers();
    const deps = fixture();
    const running = runDaemonHost('/native', deps);
    deps.signals.emit('SIGTERM');
    deps.close();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS * 2);
    expect(await running).toBe(1);
    expect(deps.child.kill.mock.calls).toEqual([['SIGTERM']]);
  });

  it('stops the child if its private log closes prematurely', async () => {
    const deps = fixture();
    const running = runDaemonHost('/native', deps);
    deps.log.emit('close');
    deps.close();
    expect(await running).toBe(1);
    expect(deps.child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('stops the child if its log write throws synchronously', async () => {
    const deps = fixture();
    vi.spyOn(deps.log, 'write').mockImplementation(() => {
      throw new Error('write failure');
    });
    const running = runDaemonHost('/native', deps);
    deps.child.stdout.emit('data', Buffer.from('test'));
    deps.close();
    expect(await running).toBe(1);
    expect(deps.child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects unexpected text-mode native output', async () => {
    const deps = fixture();
    const running = runDaemonHost('/native', deps);
    deps.child.stdout.emit('data', 'not a byte buffer');
    deps.close();
    expect(await running).toBe(1);
    expect(deps.output).toEqual([]);
  });
});

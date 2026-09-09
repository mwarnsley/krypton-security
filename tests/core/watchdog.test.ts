import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const ROOT = path.resolve(__dirname, '../../sandbox_workspace');
let watchdog: typeof import('../../src/core/watchdog');
beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(fs, 'realpathSync').mockImplementation((input) => String(input));
  watchdog = await import('../../src/core/watchdog.js');
});
afterEach(() => vi.restoreAllMocks());
describe('canonical path policy', () => {
  it.each(['.env', '.env.production', '.SSH/key', '../escape', '', '/outside/file'])(
    'denies %s',
    (target) => {
      expect(
        watchdog.verifyPathAccess(
          target.startsWith('/') || target === '' ? target : ROOT + '/' + target
        )
      ).toBe(false);
    }
  );
  it('allows canonical descendants', () => {
    expect(watchdog.verifyPathAccess(ROOT + '/safe')).toBe(true);
  });

  it.each(['link/../secret', 'x'.repeat(4097), 'bad\0name'])(
    'rejects ambiguous or oversized input',
    (target) => {
      expect(watchdog.verifyPathAccess(ROOT + '/' + target)).toBe(false);
    }
  );

  it('rejects a dangling symlink rather than treating it as a missing leaf', () => {
    vi.mocked(fs.realpathSync).mockImplementation((input) => {
      if (String(input).endsWith('/dangling'))
        throw Object.assign(new Error('missing target'), { code: 'ENOENT' });
      return String(input);
    });
    vi.spyOn(fs, 'lstatSync').mockReturnValue({ isSymbolicLink: () => true } as fs.Stats);
    expect(watchdog.verifyPathAccess(ROOT + '/dangling')).toBe(false);
  });
  it('rejects a symlink whose canonical target escapes', () => {
    vi.mocked(fs.realpathSync).mockImplementation((input) =>
      String(input).endsWith('/link') ? '/outside' : String(input)
    );
    expect(watchdog.verifyPathAccess(ROOT + '/link')).toBe(false);
  });
  it('checks canonical parents for missing leaves below symlinks', () => {
    vi.mocked(fs.realpathSync).mockImplementation((input) => {
      if (String(input).endsWith('/new'))
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return String(input).endsWith('/link') ? '/outside' : String(input);
    });
    vi.spyOn(fs, 'lstatSync').mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    expect(watchdog.verifyPathAccess(ROOT + '/link/new')).toBe(false);
  });
  it('allows a missing leaf under a canonical safe parent', () => {
    vi.mocked(fs.realpathSync).mockImplementation((input) => {
      if (String(input).endsWith('/new'))
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return String(input);
    });
    vi.spyOn(fs, 'lstatSync').mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    expect(watchdog.verifyPathAccess(ROOT + '/new')).toBe(true);
  });
  it.each(['EACCES', 'ELOOP', 'ENOTDIR'])('fails closed on %s', (code) => {
    vi.mocked(fs.realpathSync).mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code });
    });
    expect(watchdog.verifyPathAccess(ROOT + '/safe')).toBe(false);
  });
});
describe('observational portable watcher', () => {
  it.each([
    ['change', '.env'],
    ['rename', '../.ssh/id_rsa'],
    ['change', null],
  ])('never signals for %s %s', (event, filename) => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const stub = Object.assign(new EventEmitter(), { close: vi.fn() });
    const watch = vi.spyOn(fs, 'watch').mockReturnValue(stub as unknown as fs.FSWatcher);
    watchdog.startWorkspaceWatcher(ROOT);
    const call = watch.mock.calls[0] as unknown as [
      string,
      fs.WatchOptions,
      (event: string, filename: string | null) => void,
    ];
    call[2](event as string, filename);
    expect(kill).not.toHaveBeenCalled();
    expect(watchdog.getWorkspaceObservation()).toMatchObject({
      status: 'OBSERVED',
      attribution: 'unattributed',
      targetProcessId: null,
    });
  });
  it('marks watcher errors degraded without signaling', () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const stub = Object.assign(new EventEmitter(), { close: vi.fn() });
    vi.spyOn(fs, 'watch').mockReturnValue(stub as unknown as fs.FSWatcher);
    watchdog.startWorkspaceWatcher(ROOT);
    stub.emit('error', new Error('watch failed'));
    expect(kill).not.toHaveBeenCalled();
    expect(watchdog.getWorkspaceObservation()?.health).toBe('degraded');
    expect(stub.close).toHaveBeenCalledOnce();
  });
  it('reports setup errors without broadcasting signals', () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    vi.spyOn(fs, 'watch').mockImplementation(() => {
      throw new Error('watch failed');
    });
    expect(() => watchdog.startWorkspaceWatcher(ROOT)).toThrow('watch failed');
    expect(kill).not.toHaveBeenCalled();
    expect(watchdog.getWorkspaceObservation()?.health).toBe('degraded');
  });
});

describe('watcher failure boundaries', () => {
  it('records degraded health when canonical setup fails', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    });
    expect(() => watchdog.startWorkspaceWatcher(ROOT)).toThrow('denied');
    expect(watchdog.getWorkspaceObservation()?.health).toBe('degraded');
  });
  it('records degraded health even if watcher cleanup throws', () => {
    const stub = Object.assign(new EventEmitter(), {
      close: vi.fn(() => {
        throw new Error('cleanup failed');
      }),
    });
    vi.spyOn(fs, 'watch').mockReturnValue(stub as unknown as fs.FSWatcher);
    watchdog.startWorkspaceWatcher(ROOT);
    expect(() => stub.emit('error', new Error('watch failed'))).not.toThrow();
    expect(watchdog.getWorkspaceObservation()?.health).toBe('degraded');
  });
});

describe('safe watcher failure classification', () => {
  it('records denied path resolution as degraded permission failure', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => {
      throw Object.assign(new Error('private path'), { code: 'EPERM' });
    });
    expect(watchdog.verifyPathAccess(ROOT + '/safe')).toBe(false);
    expect(watchdog.getWorkspaceObservation()).toMatchObject({
      health: 'degraded',
      failureCode: 'permission_denied',
    });
  });
  it('normalizes unknown setup failures without losing degraded health', () => {
    vi.spyOn(fs, 'watch').mockImplementation(() => {
      throw null;
    });
    expect(() => watchdog.startWorkspaceWatcher(ROOT)).toThrow('Workspace watcher setup failed.');
    expect(watchdog.getWorkspaceObservation()?.failureCode).toBe('filesystem_failed');
  });
});

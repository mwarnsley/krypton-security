// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { SecurityAlert } from '../types';
import {
  copyProcessDetails,
  createThreatReport,
  downloadThreatReport,
  normalizeProtectedWorkspaceRoot,
  serializeDiagnosticEvent,
} from './alertDiagnostics';

const event: SecurityAlert = {
  id: 'event/../unsafe',
  attribution: 'unattributed',
  attemptedAction: 'read_file',
  attemptedPath: '/outside/file',
  enforcementStatus: 'INTERCEPTED',
  origin_attribution: 'Native MCP request (actor unattributed)',
  processName: 'krypton_read_file',
  severity: 'high',
  targetProcessId: null,
  timestamp: '2026-10-20T12:00:00.000Z',
  triggerSignature: 'NATIVE_MCP_BOUNDARY',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('exports retained evidence without inventing an actor or signature', () => {
  const report = createThreatReport(event);
  expect(report.ok).toBe(true);
  if (!report.ok) return;
  expect(report.value.content).toContain('Unsigned');
  expect(report.value.content).toContain('"targetProcessId": null');
  expect(report.value.content).toContain('NATIVE_MCP_BOUNDARY');
  expect(report.value.content).not.toContain('registered runtime agent process initiated');
  expect(report.value.filename).not.toContain('/');
});
it('excludes unexpected properties from raw diagnostics', () => {
  const result = serializeDiagnosticEvent({
    ...event,
    capability: 'FAKE-EXCLUDED-SECRET',
  } as SecurityAlert);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).not.toContain('FAKE-EXCLUDED-SECRET');
});
it('copies recorded PID, executable and parent fields exactly', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  expect(
    (
      await copyProcessDetails({
        ...event,
        attribution: 'process',
        targetProcessId: 7,
        process: { pid: 7, parentPid: 3, executablePath: '/usr/bin/node', startTime: 1 },
      })
    ).ok
  ).toBe(true);
  expect(JSON.parse(writeText.mock.calls[0]![0])).toMatchObject({
    pid: 7,
    executablePath: '/usr/bin/node',
    parentPid: 3,
  });
});
it('reports clipboard rejection without exposing exceptions', async () => {
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('private-exception')) },
  });
  expect(await copyProcessDetails(event)).toEqual({ ok: false, code: 'clipboard_failed' });
});
it('reports missing clipboard support', async () => {
  vi.stubGlobal('navigator', {});
  expect(await copyProcessDetails(event)).toEqual({ ok: false, code: 'clipboard_unavailable' });
});
it('revokes the object URL and removes a download link when activation fails', () => {
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn().mockReturnValue('blob:diagnostic'),
    revokeObjectURL,
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    throw new Error('private-failure');
  });
  expect(downloadThreatReport(event)).toEqual({ ok: false, code: 'download_failed' });
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:diagnostic');
  expect(document.querySelector('a[download]')).toBeNull();
  click.mockRestore();
});

it('rejects serialization errors with a stable code', () => {
  const malformed = { ...event, sequence: BigInt(1) } as unknown as SecurityAlert;
  expect(serializeDiagnosticEvent(malformed)).toEqual({ ok: false, code: 'serialization_failed' });
});
it('returns a redacted failure when clipboard access itself throws', async () => {
  vi.stubGlobal(
    'navigator',
    Object.defineProperty({}, 'clipboard', {
      get() {
        throw new Error('private-settings');
      },
    })
  );
  expect(await copyProcessDetails(event)).toEqual({ ok: false, code: 'clipboard_failed' });
});

it('downloads Markdown with a safe filename and releases its temporary resources', () => {
  const createObjectURL = vi.fn().mockReturnValue('blob:owned-report');
  const revokeObjectURL = vi.fn();
  const BrowserURL = URL;
  vi.stubGlobal(
    'URL',
    class extends BrowserURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
  );
  const clicks: Array<{ name: string; href: string }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicks.push({ name: this.download, href: this.href });
  });
  expect(downloadThreatReport(event, '/workspace/allowed')).toEqual({ ok: true, value: undefined });
  expect(clicks).toEqual([
    { name: 'krypton_threat_report_event____unsafe.md', href: 'blob:owned-report' },
  ]);
  expect((createObjectURL.mock.calls[0]![0] as Blob).type).toBe('text/markdown;charset=utf-8');
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:owned-report');
  expect(document.querySelector('a[download]')).toBeNull();
});

it('reports object URL allocation failure without trying to revoke an unowned URL', () => {
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => {
      throw new Error('private-allocation');
    }),
    revokeObjectURL,
  });
  expect(downloadThreatReport(event)).toEqual({ ok: false, code: 'download_failed' });
  expect(revokeObjectURL).not.toHaveBeenCalled();
  expect(document.querySelector('a[download]')).toBeNull();
});

it('reports cleanup failure instead of promising a completed download', () => {
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn().mockReturnValue('blob:owned-report'),
    revokeObjectURL: vi.fn(() => {
      throw new Error('private-cleanup');
    }),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  expect(downloadThreatReport(event)).toEqual({ ok: false, code: 'download_failed' });
  expect(document.querySelector('a[download]')).toBeNull();
});

it('still revokes its URL when removing the temporary download link fails', () => {
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn().mockReturnValue('blob:owned-report'),
    revokeObjectURL,
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  const remove = vi.spyOn(HTMLAnchorElement.prototype, 'remove').mockImplementation(() => {
    throw new Error('private-remove-failure');
  });
  try {
    expect(downloadThreatReport(event)).toEqual({ ok: false, code: 'download_failed' });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:owned-report');
  } finally {
    remove.mockRestore();
    document.querySelector('a[download]')?.remove();
  }
});

it('rejects malformed report identifiers with a redacted serialization failure', () => {
  expect(createThreatReport({ ...event, id: null } as unknown as SecurityAlert)).toEqual({
    ok: false,
    code: 'serialization_failed',
  });
});

it('preserves unavailable identity facts and the current folder qualification in reports', () => {
  const report = createThreatReport({ ...event, id: '///', sequence: 2 }, '/workspace/allowed');
  expect(report.ok).toBe(true);
  if (!report.ok) return;
  expect(report.value.content).toContain('"currentProtectedWorkspaceRoot": "/workspace/allowed"');
  expect(report.value.content).toContain('not a historical event snapshot');
  expect(report.value.content).toContain('"sequence": 2');
  expect(report.value.content).toContain('"process": null');
});

it.each([null, '', 'relative/path', '/unsafe\npath', '/unsafe\ud800path', `/${'é'.repeat(512)}`])(
  'omits unsafe or unavailable folder metadata (%j)',
  (value) => {
    expect(normalizeProtectedWorkspaceRoot(value)).toBeUndefined();
  }
);
it('accepts bounded absolute UTF-8 folder metadata and tolerates unavailable Blob support', () => {
  expect(normalizeProtectedWorkspaceRoot('/workspace/é')).toBe('/workspace/é');
  vi.stubGlobal(
    'Blob',
    class {
      constructor() {
        throw new Error('unavailable');
      }
    }
  );
  expect(normalizeProtectedWorkspaceRoot('/workspace/allowed')).toBeUndefined();
});

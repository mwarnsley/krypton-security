import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registryMocks = vi.hoisted(() => ({
  getActiveWorkspaceProcessCount: vi.fn(() => 3),
}));
const attestMocks = vi.hoisted(() => ({
  attestProcessOrigin: vi.fn(),
  deriveFallbackOriginAttribution: vi.fn(() => 'Ephemeral Shell Task'),
}));
const ipcMocks = vi.hoisted(() => ({
  isNativeDaemonReachable: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../../../core/processIsolation.cjs', () => registryMocks);
vi.mock('./attest', () => ({
  attestProcessOrigin: attestMocks.attestProcessOrigin,
  deriveFallbackOriginAttribution: attestMocks.deriveFallbackOriginAttribution,
}));
vi.mock('./ipc', () => ipcMocks);

import { GET } from './route';

const ALERTS_LEDGER_PATH = path.resolve(process.cwd(), 'alerts.json');

beforeEach(() => {
  registryMocks.getActiveWorkspaceProcessCount.mockReturnValue(3);
  attestMocks.attestProcessOrigin.mockResolvedValue('Ephemeral Shell Task');
  ipcMocks.isNativeDaemonReachable.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('telemetry route', () => {
  it('returns newline-delimited alerts with the newest first', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      '{"timestamp":"oldest"}\n{"timestamp":"newest"}'
    );

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual({
      activeProcessCount: 3,
      alerts: [
        { origin_attribution: 'Ephemeral Shell Task', timestamp: 'newest' },
        { origin_attribution: 'Ephemeral Shell Task', timestamp: 'oldest' },
      ],
    });
  });

  it('returns JSON array alerts with the newest first', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      '[{"timestamp":"oldest"},{"timestamp":"newest"}]'
    );

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual({
      activeProcessCount: 3,
      alerts: [
        { origin_attribution: 'Ephemeral Shell Task', timestamp: 'newest' },
        { origin_attribution: 'Ephemeral Shell Task', timestamp: 'oldest' },
      ],
    });
  });

  it('returns empty alerts for an empty ledger', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('   \n');

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual({ activeProcessCount: 3, alerts: [] });
  });

  it('returns one structured JSON object as one alert', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('{"action":"process_quarantined"}');

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual({
      activeProcessCount: 3,
      alerts: [{ action: 'process_quarantined', origin_attribution: 'Ephemeral Shell Task' }],
    });
  });

  it('attests distinct process IDs before returning alerts', async () => {
    attestMocks.attestProcessOrigin.mockResolvedValue('@scope/dependency-name');
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      '[{"targetProcessId":4242,"attemptedPath":"/workspace/scripts/setup.sh","timestamp":"oldest"},{"targetProcessId":4242,"attemptedPath":"/workspace/scripts/setup.sh","timestamp":"newest"}]'
    );

    const response = await GET();
    const body: unknown = await response.json();

    expect(attestMocks.attestProcessOrigin).toHaveBeenCalledOnce();
    expect(attestMocks.attestProcessOrigin).toHaveBeenCalledWith(4242, {
      attemptedPath: '/workspace/scripts/setup.sh',
    });
    expect(body).toEqual({
      activeProcessCount: 3,
      alerts: [
        {
          origin_attribution: '@scope/dependency-name',
          attemptedPath: '/workspace/scripts/setup.sh',
          targetProcessId: 4242,
          timestamp: 'newest',
        },
        {
          origin_attribution: '@scope/dependency-name',
          attemptedPath: '/workspace/scripts/setup.sh',
          targetProcessId: 4242,
          timestamp: 'oldest',
        },
      ],
    });
  });

  it('retains an origin attribution already written to a ledger alert', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      '{"targetProcessId":4242,"origin_attribution":"scripts/setup.sh"}'
    );

    const response = await GET();
    const body: unknown = await response.json();

    expect(attestMocks.attestProcessOrigin).not.toHaveBeenCalled();
    expect(body).toEqual({
      activeProcessCount: 3,
      alerts: [
        {
          origin_attribution: 'scripts/setup.sh',
          targetProcessId: 4242,
        },
      ],
    });
  });

  it('rejects a primitive JSON ledger value', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('42');

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual({ activeProcessCount: 3, alerts: [] });
  });

  it('filters non-record values from a JSON array ledger', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('[null,[],42,{"timestamp":"valid"}]');

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual({
      activeProcessCount: 3,
      alerts: [{ origin_attribution: 'Ephemeral Shell Task', timestamp: 'valid' }],
    });
  });

  it('reads the root alerts ledger asynchronously', async () => {
    const readFileSpy = vi.spyOn(fs.promises, 'readFile').mockResolvedValue('[]');

    await GET();

    expect(readFileSpy).toHaveBeenCalledWith(ALERTS_LEDGER_PATH, 'utf8');
  });

  it('returns status 200 when the ledger does not exist', async () => {
    const missingLedgerError = Object.assign(new Error('missing ledger'), {
      code: 'ENOENT',
    });
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(missingLedgerError);

    const response = await GET();

    expect(response.status).toBe(200);
  });

  it('returns mock alerts when the ledger does not exist', async () => {
    const missingLedgerError = Object.assign(new Error('missing ledger'), {
      code: 'ENOENT',
    });
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(missingLedgerError);

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual(
      expect.objectContaining({
        activeProcessCount: 0,
        nativeDaemonReachable: true,
        source: 'mock',
      })
    );
    expect((body as { alerts: unknown[] }).alerts).not.toHaveLength(0);
  });

  it('returns status 200 when the ledger contains malformed JSON', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('not-json');

    const response = await GET();

    expect(response.status).toBe(200);
  });

  it('returns mock alerts for malformed ledger data', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('not-json');

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual(expect.objectContaining({ source: 'mock' }));
    expect((body as { alerts: unknown[] }).alerts).not.toHaveLength(0);
  });

  it('falls back when a newline-delimited record is not an object', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('{"timestamp":"valid"}\n42');

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual(expect.objectContaining({ source: 'mock' }));
  });

  it('falls back for a non-filesystem read rejection', async () => {
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue('read failure');

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual(expect.objectContaining({ source: 'mock' }));
  });

  it('falls back for filesystem errors other than ENOENT', async () => {
    const permissionError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(permissionError);

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual(expect.objectContaining({ source: 'mock' }));
  });

  it('uses mock telemetry without reading the ledger when the daemon is unreachable', async () => {
    const readFileSpy = vi.spyOn(fs.promises, 'readFile');
    ipcMocks.isNativeDaemonReachable.mockResolvedValue(false);

    const response = await GET();
    const body: unknown = await response.json();

    expect(readFileSpy).not.toHaveBeenCalled();
    expect(body).toEqual(
      expect.objectContaining({
        activeProcessCount: 0,
        nativeDaemonReachable: false,
        source: 'mock',
      })
    );
  });

  it('reads the active process count from the core registry', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('[]');
    registryMocks.getActiveWorkspaceProcessCount.mockReturnValue(7);

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual({ activeProcessCount: 7, alerts: [] });
  });
});

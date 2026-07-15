import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registryMocks = vi.hoisted(() => ({
  getActiveWorkspaceProcessCount: vi.fn(() => 3),
}));

vi.mock('../../../../core/processIsolation.cjs', () => registryMocks);

import { GET } from './route';

const ALERTS_LEDGER_PATH = path.resolve(process.cwd(), 'alerts.json');

beforeEach(() => {
  registryMocks.getActiveWorkspaceProcessCount.mockReturnValue(3);
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
      alerts: [{ timestamp: 'newest' }, { timestamp: 'oldest' }],
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
      alerts: [{ timestamp: 'newest' }, { timestamp: 'oldest' }],
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
      alerts: [{ action: 'process_quarantined' }],
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
      alerts: [{ timestamp: 'valid' }],
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

  it('returns empty alerts when the ledger does not exist', async () => {
    const missingLedgerError = Object.assign(new Error('missing ledger'), {
      code: 'ENOENT',
    });
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(missingLedgerError);

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual({ activeProcessCount: 3, alerts: [] });
  });

  it('fails closed when the ledger contains malformed JSON', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('not-json');

    const response = await GET();

    expect(response.status).toBe(500);
  });

  it('returns empty alerts for malformed ledger data', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('not-json');

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual({ activeProcessCount: 3, alerts: [] });
  });

  it('fails closed when a newline-delimited record is not an object', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('{"timestamp":"valid"}\n42');

    const response = await GET();

    expect(response.status).toBe(500);
  });

  it('fails closed for a non-filesystem read rejection', async () => {
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue('read failure');

    const response = await GET();

    expect(response.status).toBe(500);
  });

  it('fails closed for filesystem errors other than ENOENT', async () => {
    const permissionError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(permissionError);

    const response = await GET();

    expect(response.status).toBe(500);
  });

  it('reads the active process count from the core registry', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('[]');
    registryMocks.getActiveWorkspaceProcessCount.mockReturnValue(7);

    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toEqual({ activeProcessCount: 7, alerts: [] });
  });
});

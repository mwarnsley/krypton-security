import * as fs from 'node:fs';
import * as path from 'node:path';

import type { TelemetryPage } from '../../types';
import { MAX_LEDGER_READ_BYTES } from './constants';
import { normalizePersistedEvent } from './normalizeTelemetry';

const LEDGER_PATH = path.resolve(process.cwd(), '.krypton/telemetry/alerts.jsonl');

export interface LedgerPage extends TelemetryPage {
  /** Validated native events mapped to the dashboard schema. */
  readonly alerts: ReturnType<typeof normalizePersistedEvent>[];
}

export async function readLedgerPage(
  after: number | undefined,
  limit: number
): Promise<LedgerPage> {
  const handle = await fs.promises.open(LEDGER_PATH, 'r');
  try {
    const stats = await handle.stat();
    const bytesToRead = Math.min(stats.size, MAX_LEDGER_READ_BYTES);
    const start = Math.max(0, stats.size - bytesToRead);
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, start);
    const completeAtStart = start === 0 || buffer.indexOf(10) >= 0;
    let contents = buffer.toString('utf8');
    if (start > 0) {
      const firstNewline = contents.indexOf('\n');
      contents = firstNewline >= 0 ? contents.slice(firstNewline + 1) : '';
    }
    const endedWithNewline = contents.endsWith('\n');
    const lines = contents.split('\n');
    if (lines.at(-1) === '') lines.pop();
    if (!endedWithNewline) lines.pop();
    if (!completeAtStart) {
      throw new TypeError('The bounded ledger window contains no complete record.');
    }
    const events = lines.map((line) => {
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch {
        throw new TypeError('The native telemetry ledger contains invalid JSON.');
      }
      return normalizePersistedEvent(value);
    });
    const eligible =
      after === undefined
        ? events.slice(-limit)
        : events.filter((event) => {
            return event.sequence !== undefined && event.sequence > after;
          });
    const pageAlerts = eligible.slice(0, limit);
    const nextAfter = pageAlerts.reduce<number | undefined>(
      (latest, event) => Math.max(latest ?? 0, event.sequence ?? 0),
      after
    );
    return {
      alerts: pageAlerts,
      hasMore: eligible.length > pageAlerts.length,
      ...(nextAfter === undefined ? {} : { nextAfter }),
    };
  } finally {
    await handle.close();
  }
}

export { LEDGER_PATH };

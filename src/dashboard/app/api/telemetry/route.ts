import * as fs from 'node:fs';
import * as path from 'node:path';

import { getActiveWorkspaceProcessCount } from '../../../../core/processIsolation.cjs';
import { attestProcessOrigin, deriveFallbackOriginAttribution } from './attest';
import { isNativeDaemonReachable } from './ipc';
import { generateMockTelemetryEvents } from './mockTelemetry';

export const runtime = 'nodejs';

const ALERTS_LEDGER_PATH = path.resolve(process.cwd(), 'alerts.json');

type AlertRecord = Record<string, unknown>;

/**
 * Determines whether a parsed JSON value is a structured alert record.
 *
 * @param {unknown} value - The parsed JSON value to inspect.
 * @returns {boolean} `true` when the value is a non-array object.
 * @complexity O(1) time and O(1) space.
 * @example
 * isAlertRecord({ action: "process_quarantined" });
 * // => true
 */
function isAlertRecord(value: unknown): value is AlertRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a positive process identifier from the current or legacy alert schema.
 *
 * @param {AlertRecord} alert - The raw ledger alert to inspect.
 * @returns {number | undefined} The valid PID or `undefined` for malformed input.
 * @complexity O(1) time and O(1) space.
 * @example
 * readTargetProcessId({ targetProcessId: 4242 });
 * // => 4242
 */
function readTargetProcessId(alert: AlertRecord): number | undefined {
  const candidate = typeof alert.targetProcessId === 'number' ? alert.targetProcessId : alert.pid;

  return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate > 0
    ? candidate
    : undefined;
}

/**
 * Appends origin attribution to every raw alert before frontend publication.
 *
 * Repeated PID/path pairs within one ledger snapshot share the same asynchronous
 * lookup. Existing non-empty attribution is retained for forward compatibility.
 *
 * @param {AlertRecord[]} alerts - The raw structured ledger alerts to enrich.
 * @returns {Promise<AlertRecord[]>} Alerts with an explicit `origin_attribution` field.
 * @complexity O(A + P * C) time and O(A + P) space for A alerts, P unique PID/path
 * contexts, and bounded process-command length C.
 * @example
 * await appendOriginAttributions([{ targetProcessId: 4242 }]);
 * // => [{ targetProcessId: 4242, origin_attribution: "scripts/agent.ts" }]
 */
async function appendOriginAttributions(alerts: AlertRecord[]): Promise<AlertRecord[]> {
  const pendingAttributions = new Map<string, Promise<string>>();

  return Promise.all(
    alerts.map(async (alert) => {
      if (typeof alert.origin_attribution === 'string' && alert.origin_attribution.trim() !== '') {
        return alert;
      }

      const targetProcessId = readTargetProcessId(alert);
      const attemptedPath =
        typeof alert.attemptedPath === 'string'
          ? alert.attemptedPath
          : typeof alert.illegalPath === 'string'
            ? alert.illegalPath
            : undefined;

      if (targetProcessId === undefined) {
        return {
          ...alert,
          origin_attribution: deriveFallbackOriginAttribution(attemptedPath),
        };
      }

      const attestationKey = `${String(targetProcessId)}:${attemptedPath ?? ''}`;
      let pendingAttribution = pendingAttributions.get(attestationKey);

      if (pendingAttribution === undefined) {
        pendingAttribution = attestProcessOrigin(targetProcessId, { attemptedPath });
        pendingAttributions.set(attestationKey, pendingAttribution);
      }

      return { ...alert, origin_attribution: await pendingAttribution };
    })
  );
}

/**
 * Parses either a JSON array ledger or the watchdog's newline-delimited ledger.
 *
 * @param {string} ledgerContents - The raw UTF-8 contents of `alerts.json`.
 * @returns {AlertRecord[]} The structured alert records in append order.
 * @complexity O(N) time and O(N) space for N ledger characters and records.
 * @example
 * parseAlertLedger('{"pid":1}\n{"pid":2}');
 * // => [{ pid: 1 }, { pid: 2 }]
 */
function parseAlertLedger(ledgerContents: string): AlertRecord[] {
  const normalizedContents = ledgerContents.trim();

  if (normalizedContents === '') {
    return [];
  }

  try {
    const parsedLedger: unknown = JSON.parse(normalizedContents);

    if (Array.isArray(parsedLedger)) {
      return parsedLedger.filter(isAlertRecord);
    }

    return isAlertRecord(parsedLedger) ? [parsedLedger] : [];
  } catch {
    return normalizedContents.split('\n').map((line) => {
      const parsedAlert: unknown = JSON.parse(line);

      if (!isAlertRecord(parsedAlert)) {
        throw new TypeError('The alert ledger contains an invalid record.');
      }

      return parsedAlert;
    });
  }
}

/**
 * Builds a successful, explicitly identified mock telemetry response.
 *
 * @param {boolean} nativeDaemonReachable - Whether the daemon passed its health probe.
 * @returns {Response} A resilient table-compatible fallback payload.
 * @complexity O(1) time and space for the fixed-size fallback snapshot.
 * @example
 * createMockTelemetryResponse(false);
 * // => Response with source "mock" and high-fidelity fallback alerts
 */
function createMockTelemetryResponse(nativeDaemonReachable: boolean): Response {
  return Response.json(
    {
      activeProcessCount: 0,
      alerts: generateMockTelemetryEvents(),
      nativeDaemonReachable,
      source: 'mock',
    },
    { status: 200 }
  );
}

/**
 * Returns native telemetry or a high-fidelity fallback when the daemon or ledger is unavailable.
 *
 * @returns {Promise<Response>} A JSON response containing newest-first native or mock alerts.
 * @complexity O(N) time and O(N) space to probe, read, parse, copy, and reverse N alert data.
 * @example
 * const response = await GET();
 * await response.json();
 * // => { activeProcessCount: 2, alerts: [{ timestamp: "newest" }] }
 */
export async function GET(): Promise<Response> {
  const nativeDaemonReachable = await isNativeDaemonReachable();

  if (!nativeDaemonReachable) {
    return createMockTelemetryResponse(false);
  }

  try {
    const activeProcessCount = getActiveWorkspaceProcessCount();
    const ledgerContents = await fs.promises.readFile(ALERTS_LEDGER_PATH, 'utf8');
    const alerts = await appendOriginAttributions(parseAlertLedger(ledgerContents));
    const newestAlertsFirst = [...alerts].reverse();

    return Response.json({ activeProcessCount, alerts: newestAlertsFirst }, { status: 200 });
  } catch {
    return createMockTelemetryResponse(true);
  }
}

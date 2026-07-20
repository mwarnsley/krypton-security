import type { ProcessIdentityPayload, SecurityAlert, TelemetrySeverity } from '../../types';
import { MAX_ALERT_CATEGORY_LENGTH, MAX_ALERT_FIELD_LENGTH } from './constants';

export type PersistedEventRecord = Record<string, unknown>;

function isRecord(value: unknown): value is PersistedEventRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`Native telemetry ${label} is invalid.`);
  }
  return value;
}

function processIdentity(value: unknown): ProcessIdentityPayload | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    typeof value.pid !== 'number' ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.startTime !== 'number' ||
    !Number.isSafeInteger(value.startTime) ||
    value.startTime <= 0 ||
    typeof value.executablePath !== 'string' ||
    value.executablePath.length > MAX_ALERT_FIELD_LENGTH ||
    (value.parentPid !== null &&
      (typeof value.parentPid !== 'number' || !Number.isSafeInteger(value.parentPid)))
  ) {
    throw new TypeError('Native telemetry process identity is invalid.');
  }
  return {
    executablePath: value.executablePath,
    parentPid: value.parentPid,
    pid: value.pid,
    startTime: value.startTime,
  };
}

function severity(value: unknown): TelemetrySeverity {
  if (
    value === 'critical' ||
    value === 'high' ||
    value === 'info' ||
    value === 'low' ||
    value === 'medium'
  ) {
    return value;
  }
  throw new TypeError('Native telemetry severity is invalid.');
}

export function normalizePersistedEvent(value: unknown): SecurityAlert {
  if (!isRecord(value)) throw new TypeError('Native telemetry event must be an object.');
  const sequence = value.sequence;
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new TypeError('Native telemetry sequence is invalid.');
  }
  const attribution = value.attribution;
  if (attribution !== 'process' && attribution !== 'unattributed') {
    throw new TypeError('Native telemetry attribution is invalid.');
  }
  const process = processIdentity(value.process);
  if (attribution === 'process' && process === undefined) {
    throw new TypeError('Process-attributed telemetry requires a compound identity.');
  }
  const category = boundedString(value.category, 'category', MAX_ALERT_CATEGORY_LENGTH);
  const attemptedPath = boundedString(value.path, 'path', MAX_ALERT_FIELD_LENGTH);
  const capturedAt = boundedString(value.capturedAt, 'timestamp', 64);
  const id = boundedString(value.id, 'id', 256);
  return {
    attemptedAction: category === 'workspace_boundary' ? 'filesystem_boundary_breakout' : category,
    attemptedPath,
    attribution,
    enforcementStatus: 'INTERCEPTED',
    id,
    origin_attribution:
      attribution === 'process'
        ? (process?.executablePath ?? 'Unknown process')
        : 'Unattributed portable watcher event',
    ...(process === undefined ? {} : { process }),
    processName: process?.executablePath.split('/').at(-1) ?? 'Unattributed filesystem event',
    sequence,
    severity: severity(value.severity),
    targetProcessId: process?.pid ?? null,
    timestamp: capturedAt,
    triggerSignature:
      attribution === 'process' ? 'NATIVE_PROCESS_ADAPTER' : 'NATIVE_PORTABLE_WATCHER',
  };
}

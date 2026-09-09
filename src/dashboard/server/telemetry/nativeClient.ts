import {
  dispatchNativeControl,
  discoverNativeEndpoint as discoverEndpoint,
} from '../../../core/processIsolation.cjs';
import { normalizeNativeHealth } from '../../utils/nativeHealth';

import {
  type NativeDaemonHealth,
  type NativeControlCommand,
  type NativeControlResponse,
  type RuntimeEndpointRecord,
} from '../../types';
type JsonRecord = Record<string, unknown>;

/**
 * Narrows untrusted data to a non-array JSON record.
 * @param {unknown} value - Untrusted JSON value.
 * @returns {boolean} Whether property validation can proceed.
 * @complexity O(1) time and space.
 * @example isRecord(null); // false
 */
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates the dashboard discovery field contract after shared path validation.
 * @param {unknown} value - Untrusted discovery record.
 * @returns {RuntimeEndpointRecord} Typed record or validation rejection.
 * @complexity O(1) time and auxiliary space.
 * @example parseEndpointRecord(null); // throws
 */
function parseEndpointRecord(value: unknown): RuntimeEndpointRecord {
  if (
    !isRecord(value) ||
    typeof value.capabilityFile !== 'string' ||
    typeof value.endpoint !== 'string' ||
    typeof value.pid !== 'number' ||
    typeof value.protocolVersion !== 'number' ||
    typeof value.startedAt !== 'string'
  ) {
    throw new TypeError('Native endpoint discovery record is invalid.');
  }
  return {
    capabilityFile: value.capabilityFile,
    endpoint: value.endpoint,
    pid: value.pid,
    protocolVersion: value.protocolVersion,
    startedAt: value.startedAt,
  };
}

/**
 * Validates native response fields and health without inventing missing counts.
 * @param {unknown} value - Bounded response from authenticated transport.
 * @returns {NativeControlResponse} Typed native response or validation rejection.
 * @complexity O(1) time and auxiliary space for the fixed response schema.
 * @example parseNativeResponse(null); // throws
 */
function parseNativeResponse(value: unknown): NativeControlResponse {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    typeof value.ok !== 'boolean' ||
    typeof value.protocolVersion !== 'number' ||
    typeof value.requestId !== 'string'
  ) {
    throw new TypeError('Native control response is invalid.');
  }
  const activeProcessCount = value.activeProcessCount;
  if (
    activeProcessCount !== undefined &&
    (typeof activeProcessCount !== 'number' ||
      !Number.isSafeInteger(activeProcessCount) ||
      activeProcessCount < 0)
  ) {
    throw new TypeError('Native active process count is invalid.');
  }
  const healthValue = value.health;
  const health: NativeDaemonHealth | undefined = normalizeNativeHealth(healthValue);
  if (healthValue !== undefined && health === undefined) {
    throw new TypeError('Native health response is invalid.');
  }
  return {
    code: value.code,
    ok: value.ok,
    protocolVersion: value.protocolVersion,
    requestId: value.requestId,
    ...(activeProcessCount === undefined ? {} : { activeProcessCount }),
    ...(health === undefined ? {} : { health }),
  };
}

/**
 * Reads bounded private discovery using the same trust boundary as native supervision.
 * @returns {Promise<RuntimeEndpointRecord>} Validated workspace discovery or rejection.
 * @complexity O(L) time and space for bounded metadata L.
 * @example await discoverNativeEndpoint();
 */
export async function discoverNativeEndpoint(): Promise<RuntimeEndpointRecord> {
  return parseEndpointRecord(await discoverEndpoint(process.cwd()));
}

/**
 * Sends dashboard commands through the shared 1500 ms authenticated native transport.
 * @param {NativeControlCommand} command - Dashboard control request.
 * @returns {Promise<NativeControlResponse>} Validated response; unavailable or malformed native state rejects.
 * @complexity O(L) time and space for bounded request and response bytes L.
 * @example await dispatchNativeCommand({ type: 'health' });
 */
export async function dispatchNativeCommand(
  command: NativeControlCommand
): Promise<NativeControlResponse> {
  return parseNativeResponse(await dispatchNativeControl({ ...command }, process.cwd()));
}

/**
 * Queries native health and degrades unknown registry state without fabricating zero.
 * @returns {Promise<NativeControlResponse>} Native health or transport/validation rejection.
 * @complexity O(L) time and space for bounded IPC frame length L.
 * @example await queryNativeHealth();
 */
export async function queryNativeHealth(): Promise<NativeControlResponse> {
  const response = await dispatchNativeCommand({ type: 'health' });
  if (!response.ok || response.health === undefined) {
    throw new Error('Native daemon did not return a valid health response.');
  }
  if (response.activeProcessCount === undefined) {
    return {
      ...response,
      health: { ...response.health, registry: 'degraded', status: 'degraded' },
    };
  }
  return response;
}

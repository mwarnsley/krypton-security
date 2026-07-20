import * as fs from 'node:fs';
import { createConnection } from 'node:net';
import * as path from 'node:path';

import {
  NATIVE_CONTROL_PROTOCOL_VERSION,
  type NativeDaemonHealth,
  type NativeControlCommand,
  type NativeControlRequest,
  type NativeControlResponse,
  type RuntimeEndpointRecord,
} from '../../types';
import { MAX_NATIVE_RESPONSE_BYTES } from './constants';

const IPC_TIMEOUT_MS = 2_000;
const RUNTIME_RECORD_PATH = path.resolve(process.cwd(), '.krypton/runtime/daemon.json');

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
  const health: NativeDaemonHealth | undefined =
    isRecord(healthValue) &&
    (healthValue.status === 'degraded' || healthValue.status === 'healthy') &&
    (healthValue.watcher === 'ready' || healthValue.watcher === 'write_failed') &&
    (healthValue.ledger === 'ready' || healthValue.ledger === 'write_failed') &&
    (healthValue.ipc === 'ready' || healthValue.ipc === 'write_failed') &&
    (healthValue.mode === 'active_enforcement' || healthValue.mode === 'audit_only')
      ? {
          ipc: healthValue.ipc,
          ledger: healthValue.ledger,
          mode: healthValue.mode,
          status: healthValue.status,
          watcher: healthValue.watcher,
        }
      : undefined;
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

export async function discoverNativeEndpoint(): Promise<RuntimeEndpointRecord> {
  const contents = await fs.promises.readFile(RUNTIME_RECORD_PATH, 'utf8');
  return parseEndpointRecord(JSON.parse(contents) as unknown);
}

export async function dispatchNativeCommand(
  command: NativeControlCommand
): Promise<NativeControlResponse> {
  const endpoint = await discoverNativeEndpoint();
  if (endpoint.protocolVersion !== NATIVE_CONTROL_PROTOCOL_VERSION) {
    throw new Error('Native endpoint protocol version is unsupported.');
  }
  const capability = (await fs.promises.readFile(endpoint.capabilityFile, 'utf8')).trim();
  if (capability.length !== 64) {
    throw new Error('Native capability file is invalid.');
  }
  const requestId = `dashboard-${process.pid}-${Date.now().toString(36)}`;
  const request: NativeControlRequest = {
    capability,
    command,
    protocolVersion: NATIVE_CONTROL_PROTOCOL_VERSION,
    requestId,
  };

  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint.endpoint);
    let receipt = '';
    let settled = false;

    const complete = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      try {
        const parsed = parseNativeResponse(JSON.parse(receipt.trim()) as unknown);
        if (parsed.protocolVersion !== NATIVE_CONTROL_PROTOCOL_VERSION) {
          throw new Error('Native response protocol version is unsupported.');
        }
        if (parsed.requestId !== requestId) {
          throw new Error('Native response request identifier does not match.');
        }
        resolve(parsed);
      } catch (parseError: unknown) {
        reject(parseError instanceof Error ? parseError : new Error('Native response is invalid.'));
      }
    };

    socket.setEncoding('utf8');
    socket.setTimeout(IPC_TIMEOUT_MS);
    socket.once('connect', () => socket.end(`${JSON.stringify(request)}\n`, 'utf8'));
    socket.on('data', (chunk: string) => {
      receipt += chunk;
      if (Buffer.byteLength(receipt, 'utf8') > MAX_NATIVE_RESPONSE_BYTES) {
        complete(new Error('Native control response is oversized.'));
      }
    });
    socket.once('end', () => complete());
    socket.once('close', (hadError) => {
      if (!hadError && receipt !== '') complete();
    });
    socket.once('timeout', () => complete(new Error('Native control request timed out.')));
    socket.once('error', (error) => complete(error));
  });
}

export async function queryNativeHealth(): Promise<NativeControlResponse> {
  const response = await dispatchNativeCommand({ type: 'health' });
  if (!response.ok || response.health === undefined) {
    throw new Error('Native daemon did not return a valid health response.');
  }
  return response;
}

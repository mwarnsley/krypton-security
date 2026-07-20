import { dispatchNativeCommand } from '../../../../server/telemetry/nativeClient';
import type { ProcessIdentityPayload } from '../../../../types';

export const runtime = 'nodejs';

const ROUTE_LOG_PREFIX = '[API /api/telemetry/terminate]';
const DISPATCH_SUCCESS_MESSAGE = 'Target child process successfully verified and isolated.';
const OWNERSHIP_REJECTION_MESSAGE =
  'Isolation rejected: target process is not an authorized Krypton workspace child.';

type RequestBody = Record<string, unknown>;

function isRecord(value: unknown): value is RequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProcessIdentity(value: unknown): ProcessIdentityPayload | undefined {
  if (
    !isRecord(value) ||
    typeof value.pid !== 'number' ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.startTime !== 'number' ||
    !Number.isSafeInteger(value.startTime) ||
    value.startTime <= 0 ||
    typeof value.executablePath !== 'string' ||
    value.executablePath.length === 0 ||
    value.executablePath.length > 2048 ||
    (value.parentPid !== null &&
      (typeof value.parentPid !== 'number' || !Number.isSafeInteger(value.parentPid)))
  ) {
    return undefined;
  }
  return {
    executablePath: value.executablePath,
    parentPid: value.parentPid,
    pid: value.pid,
    startTime: value.startTime,
  };
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { success: false, error: 'The request body must contain valid JSON.' },
      { status: 400 }
    );
  }
  const identity = isRecord(payload) ? parseProcessIdentity(payload.process) : undefined;
  if (identity === undefined) {
    return Response.json(
      { success: false, error: 'A valid compound process identity is required.' },
      { status: 400 }
    );
  }
  if (identity.pid === process.pid) {
    return Response.json(
      { success: false, error: 'The AegisAgent dashboard process cannot isolate itself.' },
      { status: 400 }
    );
  }
  try {
    const nativeResponse = await dispatchNativeCommand({
      process: identity,
      type: 'isolate_process',
    });
    if (nativeResponse.ok && nativeResponse.code === 'process_isolated') {
      return Response.json({ success: true, message: DISPATCH_SUCCESS_MESSAGE }, { status: 200 });
    }
    if (
      nativeResponse.code === 'process_not_registered' ||
      nativeResponse.code === 'process_identity_mismatch' ||
      nativeResponse.code === 'stale_process_identity'
    ) {
      return Response.json(
        { success: false, message: OWNERSHIP_REJECTION_MESSAGE },
        { status: 403 }
      );
    }
    if (nativeResponse.code === 'audit_only') {
      return Response.json(
        { success: false, message: 'Isolation is disabled while Audit-Only Mode is active.' },
        { status: 409 }
      );
    }
    console.error(`${ROUTE_LOG_PREFIX} Native isolation rejected.`, { code: nativeResponse.code });
    return Response.json(
      { success: false, error: 'The native vanguard core did not confirm isolation.' },
      { status: 502 }
    );
  } catch (error: unknown) {
    console.error(`${ROUTE_LOG_PREFIX} Native IPC dispatch failed.`, {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return Response.json(
      { success: false, error: 'The native vanguard core is unavailable.' },
      { status: 502 }
    );
  }
}

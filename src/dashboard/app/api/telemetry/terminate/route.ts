import { dispatchNativeCommand } from '../ipc';

export const runtime = 'nodejs';

const IPC_AUDIT_ONLY_RECEIPT = 'ERROR: AUDIT_ONLY';
const IPC_PID_NOT_OWNED_RECEIPT = 'ERROR: PID_NOT_OWNED';
const IPC_SUCCESS_RECEIPT = 'SUCCESS: PID_ISOLATED';
const MAX_UNSIGNED_32_BIT_INTEGER = 4_294_967_295;
const REQUIRED_PID_KEY = 'targetProcessId';
const ROUTE_LOG_PREFIX = '[API /api/telemetry/terminate]';
const DISPATCH_SUCCESS_MESSAGE = 'Target child process successfully verified and isolated.';
const OWNERSHIP_REJECTION_MESSAGE =
  'Isolation rejected: target process is not an authorized Krypton workspace child.';

type RequestBody = Record<string, unknown>;

/**
 * Determines whether an unknown JSON value is an object request body.
 *
 * @param {unknown} value - The parsed request payload to inspect.
 * @returns {boolean} `true` when the value is a non-array object.
 * @complexity O(1) time and O(1) space.
 * @example
 * isRequestBody({ targetProcessId: 4242 });
 * // => true
 */
function isRequestBody(value: unknown): value is RequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Sends one validated dashboard isolation request to the native Krypton daemon.
 *
 * @param {Request} request - The JSON request containing `targetProcessId`.
 * @returns {Promise<Response>} A JSON execution result with HTTP 200, 400, 403, 409, or 502.
 * @complexity O(1) validation and IPC dispatch time with O(1) auxiliary space.
 * @example
 * const response = await POST(new Request("http://localhost/api/telemetry/terminate", {
 *   method: "POST",
 *   body: JSON.stringify({ targetProcessId: 4242 }),
 * }));
 * // => Response { status: 200 }
 */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    console.error(
      `${ROUTE_LOG_PREFIX} Missing required keys: ${REQUIRED_PID_KEY}. Request body is not valid JSON.`
    );
    return Response.json(
      { success: false, error: 'The request body must contain valid JSON.' },
      { status: 400 }
    );
  }

  if (!isRequestBody(payload) || !Object.prototype.hasOwnProperty.call(payload, REQUIRED_PID_KEY)) {
    console.error(`${ROUTE_LOG_PREFIX} Missing required keys: ${REQUIRED_PID_KEY}.`);
    return Response.json(
      {
        success: false,
        error: `Missing required keys: ${REQUIRED_PID_KEY}.`,
      },
      { status: 400 }
    );
  }

  const targetProcessId = payload.targetProcessId;

  if (
    typeof targetProcessId !== 'number' ||
    !Number.isFinite(targetProcessId) ||
    !Number.isSafeInteger(targetProcessId) ||
    targetProcessId <= 0 ||
    targetProcessId > MAX_UNSIGNED_32_BIT_INTEGER
  ) {
    console.error(
      `${ROUTE_LOG_PREFIX} Missing required keys: none. Invalid keys: ${REQUIRED_PID_KEY}.`
    );
    return Response.json(
      {
        success: false,
        error: `${REQUIRED_PID_KEY} must be a positive unsigned 32-bit integer.`,
      },
      { status: 400 }
    );
  }

  if (targetProcessId === process.pid) {
    console.error(
      `${ROUTE_LOG_PREFIX} Missing required keys: none. Invalid keys: ${REQUIRED_PID_KEY} cannot reference the dashboard process.`
    );
    return Response.json(
      {
        success: false,
        error: 'The AegisAgent dashboard process cannot isolate itself.',
      },
      { status: 400 }
    );
  }

  let executionReceipt: string;

  try {
    executionReceipt = await dispatchNativeCommand(`ISOLATE:${String(targetProcessId)}`);
  } catch (error: unknown) {
    console.error(
      `${ROUTE_LOG_PREFIX} Native IPC dispatch failed for PID ${String(targetProcessId)}.`,
      error
    );
    return Response.json(
      {
        success: false,
        error: 'The native vanguard core is unavailable.',
      },
      { status: 502 }
    );
  }

  if (executionReceipt === IPC_PID_NOT_OWNED_RECEIPT) {
    console.error(
      `${ROUTE_LOG_PREFIX} Native ownership verification rejected PID ${String(targetProcessId)}.`
    );
    return Response.json(
      {
        success: false,
        message: OWNERSHIP_REJECTION_MESSAGE,
      },
      { status: 403 }
    );
  }

  if (executionReceipt === IPC_AUDIT_ONLY_RECEIPT) {
    return Response.json(
      {
        success: false,
        message: 'Isolation is disabled while Audit-Only Mode is active.',
      },
      { status: 409 }
    );
  }

  if (executionReceipt !== IPC_SUCCESS_RECEIPT) {
    console.error(
      `${ROUTE_LOG_PREFIX} Native IPC returned an unexpected receipt: ${executionReceipt || '<empty>'}.`
    );
    return Response.json(
      {
        success: false,
        error: 'The native vanguard core did not confirm isolation.',
      },
      { status: 502 }
    );
  }

  return Response.json({ success: true, message: DISPATCH_SUCCESS_MESSAGE }, { status: 200 });
}

import { dispatchNativeCommand } from '../../../../server/telemetry/nativeClient';

export const runtime = 'nodejs';

const REQUIRED_AUDIT_KEY = 'auditOnly';
const ROUTE_LOG_PREFIX = '[API /api/telemetry/audit-mode]';

type RequestBody = Record<string, unknown>;

/**
 * Determines whether an unknown JSON value is an object request body.
 *
 * @param {unknown} value - The parsed request payload to inspect.
 * @returns {boolean} `true` when the value is a non-array object.
 * @complexity O(1) time and O(1) space.
 * @example
 * isRequestBody({ auditOnly: true });
 * // => true
 */
function isRequestBody(value: unknown): value is RequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Sends one validated audit-mode update to the native Krypton daemon.
 *
 * @param {Request} request - The JSON request containing an `auditOnly` boolean.
 * @returns {Promise<Response>} A JSON mode-update result with HTTP 200, 400, or 502.
 * @complexity O(1) validation and bounded IPC dispatch time with O(1) auxiliary space.
 * @example
 * const response = await POST(new Request("http://localhost/api/telemetry/audit-mode", {
 *   method: "POST",
 *   body: JSON.stringify({ auditOnly: true }),
 * }));
 * // => Response { status: 200 }
 */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    console.error(`${ROUTE_LOG_PREFIX} Request body is not valid JSON.`);
    return Response.json(
      { success: false, error: 'The request body must contain valid JSON.' },
      { status: 400 }
    );
  }

  if (!isRequestBody(payload) || typeof payload[REQUIRED_AUDIT_KEY] !== 'boolean') {
    console.error(`${ROUTE_LOG_PREFIX} ${REQUIRED_AUDIT_KEY} must be a boolean.`);
    return Response.json(
      { success: false, error: `${REQUIRED_AUDIT_KEY} must be a boolean.` },
      { status: 400 }
    );
  }

  const auditOnly = payload[REQUIRED_AUDIT_KEY];
  let executionReceipt;

  try {
    executionReceipt = await dispatchNativeCommand({ enabled: auditOnly, type: 'set_audit_mode' });
  } catch (error: unknown) {
    console.error(`${ROUTE_LOG_PREFIX} Native IPC mode update failed.`, error);
    return Response.json(
      { success: false, error: 'The native vanguard core is unavailable.' },
      { status: 502 }
    );
  }

  if (!executionReceipt.ok || executionReceipt.code !== 'audit_mode_updated') {
    console.error(
      `${ROUTE_LOG_PREFIX} Native IPC returned an unexpected receipt code: ${executionReceipt.code}.`
    );
    return Response.json(
      { success: false, error: 'The native vanguard core did not confirm the mode update.' },
      { status: 502 }
    );
  }

  return Response.json(
    {
      success: true,
      auditOnly,
      message: auditOnly ? 'Audit-Only Mode enabled.' : 'Active Enforcement restored.',
    },
    { status: 200 }
  );
}

import { quarantineProcess } from "../../../../../core/processIsolation.cjs";

export const runtime = "nodejs";

const MANUAL_CONTAINMENT_CONTEXT =
  "./sandbox_workspace/.aegisagent/manual-containment";
const UNREGISTERED_PROCESS_ERROR =
  "The process ID is not registered to this workspace.";

type RequestBody = Record<string, unknown>;

/**
 * Determines whether an unknown JSON payload is an object request body.
 *
 * @param {unknown} value - The parsed request payload to inspect.
 * @returns {boolean} `true` when the value is a non-array object.
 * @complexity O(1) time and O(1) space.
 * @example
 * isRequestBody({ targetProcessId: 4242 });
 * // => true
 */
function isRequestBody(value: unknown): value is RequestBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Determines whether a caught quarantine failure is an ownership rejection.
 *
 * @param {unknown} error - The caught watchdog failure to inspect.
 * @returns {boolean} `true` when the PID was not registered as an owned workspace process.
 * @complexity O(1) time and O(1) space.
 * @example
 * isUnregisteredProcessError(new Error("The process ID is not registered to this workspace."));
 * // => true
 */
function isUnregisteredProcessError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === UNREGISTERED_PROCESS_ERROR
  );
}

/**
 * Terminates one registered workspace child through Krypton's quarantine engine.
 *
 * @param {Request} request - The JSON request containing a `targetProcessId` number.
 * @returns {Promise<Response>} A JSON isolation result with an HTTP 200, 400, or 500 status.
 * @complexity O(1) validation, ownership lookup, and signal dispatch time with O(1) auxiliary space.
 * @example
 * const request = new Request("http://localhost/api/telemetry/terminate", {
 *   method: "POST",
 *   body: JSON.stringify({ targetProcessId: 4242 }),
 * });
 * const response = await POST(request);
 * // => Response { status: 200 }
 */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { success: false, error: "The request body must contain valid JSON." },
      { status: 400 },
    );
  }

  const targetProcessId = isRequestBody(payload)
    ? payload.targetProcessId
    : undefined;

  if (
    typeof targetProcessId !== "number" ||
    !Number.isFinite(targetProcessId) ||
    !Number.isSafeInteger(targetProcessId) ||
    targetProcessId <= 0
  ) {
    return Response.json(
      {
        success: false,
        error: "targetProcessId must be a positive, finite integer.",
      },
      { status: 400 },
    );
  }

  if (targetProcessId === process.pid) {
    return Response.json(
      {
        success: false,
        error: "The AegisAgent dashboard process cannot terminate itself.",
      },
      { status: 400 },
    );
  }

  try {
    quarantineProcess(targetProcessId, MANUAL_CONTAINMENT_CONTEXT);
  } catch (error: unknown) {
    if (isUnregisteredProcessError(error)) {
      return Response.json(
        {
          success: false,
          error: "The target PID is not a registered workspace process.",
        },
        { status: 400 },
      );
    }

    return Response.json(
      {
        success: false,
        error: "The target process could not be isolated.",
      },
      { status: 500 },
    );
  }

  return Response.json(
    { success: true, isolatedPid: targetProcessId },
    { status: 200 },
  );
}

import * as fs from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";

const ALERTS_LEDGER_PATH = path.resolve(process.cwd(), "alerts.json");

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
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  if (normalizedContents === "") {
    return [];
  }

  try {
    const parsedLedger: unknown = JSON.parse(normalizedContents);

    if (Array.isArray(parsedLedger)) {
      return parsedLedger.filter(isAlertRecord);
    }

    return isAlertRecord(parsedLedger) ? [parsedLedger] : [];
  } catch {
    return normalizedContents.split("\n").map((line) => {
      const parsedAlert: unknown = JSON.parse(line);

      if (!isAlertRecord(parsedAlert)) {
        throw new TypeError("The alert ledger contains an invalid record.");
      }

      return parsedAlert;
    });
  }
}

/**
 * Determines whether an unknown failure is a Node filesystem error.
 *
 * @param {unknown} error - The caught failure to inspect.
 * @returns {boolean} `true` when the failure exposes a filesystem error code.
 * @complexity O(1) time and O(1) space.
 * @example
 * isFileSystemError(Object.assign(new Error("missing"), { code: "ENOENT" }));
 * // => true
 */
function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * Returns the local threat ledger with the newest alert first.
 *
 * @returns {Promise<Response>} A JSON response containing reversed alert records, or an empty array when no ledger exists.
 * @complexity O(N) time and O(N) space to read, parse, copy, and reverse N alert data.
 * @example
 * const response = await GET();
 * await response.json();
 * // => [{ "timestamp": "newest" }, { "timestamp": "oldest" }]
 */
export async function GET(): Promise<Response> {
  try {
    const ledgerContents = await fs.promises.readFile(
      ALERTS_LEDGER_PATH,
      "utf8",
    );
    const alerts = parseAlertLedger(ledgerContents);
    const newestAlertsFirst = [...alerts].reverse();

    return Response.json(newestAlertsFirst, { status: 200 });
  } catch (error: unknown) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      return Response.json([], { status: 200 });
    }

    return Response.json([], { status: 500 });
  }
}

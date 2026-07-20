import type {
  NativeControlResponse,
  TelemetryFallbackReason,
  TelemetryResponse,
} from '../../../types';
import { DEFAULT_TELEMETRY_LIMIT, MAX_TELEMETRY_LIMIT } from '../../../server/telemetry/constants';
import { readLedgerPage } from '../../../server/telemetry/ledgerReader';
import { generateMockTelemetryEvents } from '../../../server/telemetry/mockTelemetry';
import { queryNativeHealth } from '../../../server/telemetry/nativeClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const;

function parseBoundedInteger(
  value: string | null,
  fallback: number | undefined,
  maximum: number
): number | undefined {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

function mockResponse(
  nativeDaemonReachable: boolean,
  fallbackReason: TelemetryFallbackReason,
  health?: NativeControlResponse['health']
): Response {
  const body: TelemetryResponse = {
    activeProcessCount: 0,
    alerts: generateMockTelemetryEvents(),
    fallbackReason,
    generatedAt: new Date().toISOString(),
    hasMore: false,
    nativeDaemonReachable,
    source: 'mock',
    ...(health === undefined ? {} : { health }),
  };
  return Response.json(body, { headers: NO_STORE_HEADERS, status: 200 });
}

export async function GET(request?: Request): Promise<Response> {
  const requestUrl = new URL(request?.url ?? 'http://localhost/api/telemetry');
  const after = parseBoundedInteger(
    requestUrl.searchParams.get('after'),
    undefined,
    Number.MAX_SAFE_INTEGER
  );
  const limit =
    parseBoundedInteger(
      requestUrl.searchParams.get('limit'),
      DEFAULT_TELEMETRY_LIMIT,
      MAX_TELEMETRY_LIMIT
    ) ?? DEFAULT_TELEMETRY_LIMIT;

  let nativeHealth: NativeControlResponse;
  try {
    nativeHealth = await queryNativeHealth();
  } catch (error: unknown) {
    console.error('[telemetry] Native endpoint discovery or health check failed.', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return mockResponse(false, 'daemon_unreachable');
  }

  if (nativeHealth.health?.status === 'degraded') {
    return mockResponse(true, 'native_degraded', nativeHealth.health);
  }

  try {
    const page = await readLedgerPage(after, Math.max(1, limit));
    const body: TelemetryResponse = {
      activeProcessCount: nativeHealth.activeProcessCount ?? 0,
      alerts: page.alerts,
      generatedAt: new Date().toISOString(),
      hasMore: page.hasMore,
      nativeDaemonReachable: true,
      source: 'native',
      ...(nativeHealth.health === undefined ? {} : { health: nativeHealth.health }),
      ...(page.nextAfter === undefined ? {} : { nextAfter: page.nextAfter }),
    };
    return Response.json(body, { headers: NO_STORE_HEADERS, status: 200 });
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    const fallbackReason: TelemetryFallbackReason =
      error instanceof TypeError
        ? 'ledger_invalid'
        : code === 'ENOENT'
          ? 'ledger_unavailable'
          : 'ledger_unavailable';
    console.error('[telemetry] Native ledger query failed.', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
      fallbackReason,
    });
    return mockResponse(true, fallbackReason, nativeHealth.health);
  }
}

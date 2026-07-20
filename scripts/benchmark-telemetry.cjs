const { performance } = require('node:perf_hooks');

const SIZES = [100, 1_000, 10_000];
const MAX_CLIENT_ROWS = 500;
const API_PAGE_SIZE = 100;
const BURST_SIZE = 100;
const POLLING_CYCLES = 6;

/**
 * Builds deterministic persisted-event fixtures for one benchmark size.
 *
 * @param {number} count - Number of fixtures to build.
 * @returns {Array<Record<string, unknown>>} Deterministic event records.
 */
function events(count) {
  return Array.from({ length: count }, (_, index) => ({
    attribution: 'unattributed',
    capturedAt: new Date(index * 1_000).toISOString(),
    category: 'workspace_boundary',
    details: {},
    id: `event-${index + 1}`,
    path: `/workspace/event-${index + 1}`,
    sequence: index + 1,
    severity: 'high',
    source: 'native',
  }));
}

for (const size of SIZES) {
  const heapBefore = process.memoryUsage().heapUsed;
  const fixture = events(size);
  const serializeStarted = performance.now();
  const jsonl = fixture.map((event) => JSON.stringify(event)).join('\n');
  const serializeMs = performance.now() - serializeStarted;
  const queryStarted = performance.now();
  const page = fixture
    .filter((event) => event.sequence > size - API_PAGE_SIZE)
    .slice(0, API_PAGE_SIZE);
  const queryMs = performance.now() - queryStarted;
  const mergeStarted = performance.now();
  const retained = [...new Map(page.map((event) => [event.id, event])).values()].slice(
    -MAX_CLIENT_ROWS
  );
  const mergeMs = performance.now() - mergeStarted;
  const burstStarted = performance.now();
  const burst = events(BURST_SIZE).map((event, index) => ({
    ...event,
    id: `burst-${size}-${index}`,
    sequence: size + index + 1,
  }));
  const afterBurst = [
    ...new Map([...retained, ...burst].map((event) => [event.id, event])).values(),
  ].slice(-MAX_CLIENT_ROWS);
  const burstMergeMs = performance.now() - burstStarted;
  const pollingStarted = performance.now();
  let cursor = Math.max(0, size - POLLING_CYCLES * API_PAGE_SIZE);
  for (let cycle = 0; cycle < POLLING_CYCLES; cycle += 1) {
    const nextPage = fixture.filter((event) => event.sequence > cursor).slice(0, API_PAGE_SIZE);
    cursor = nextPage.at(-1)?.sequence ?? cursor;
  }
  const pollingCyclesMs = performance.now() - pollingStarted;
  const tableStarted = performance.now();
  const renderedRows = afterBurst
    .slice(-API_PAGE_SIZE)
    .map((event) => [event.capturedAt, event.severity, event.category, event.path].join(' | '));
  const tableProjectionMs = performance.now() - tableStarted;
  const heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
  process.stdout.write(
    JSON.stringify({
      burstMergeMs,
      bytes: Buffer.byteLength(jsonl),
      heapDeltaBytes,
      mergeMs,
      pollingCyclesMs,
      queryMs,
      renderedRows: renderedRows.length,
      retained: afterBurst.length,
      serializeMs,
      size,
      tableProjectionMs,
    }) + '\n'
  );
}

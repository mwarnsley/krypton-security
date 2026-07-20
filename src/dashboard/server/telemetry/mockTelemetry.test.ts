import { describe, expect, it } from 'vitest';

import { generateMockTelemetryEvents, MOCK_SCENARIO_DURATION_MS } from './mockTelemetry';

const CAPTURED_AT = new Date('2026-07-19T12:00:00.000Z');

describe('generateMockTelemetryEvents', () => {
  it('is deterministic within one scenario slot', () => {
    expect(generateMockTelemetryEvents(CAPTURED_AT)).toEqual(
      generateMockTelemetryEvents(CAPTURED_AT)
    );
  });

  it('rotates scenarios when the slot advances', () => {
    const current = generateMockTelemetryEvents(CAPTURED_AT);
    const next = generateMockTelemetryEvents(
      new Date(CAPTURED_AT.getTime() + MOCK_SCENARIO_DURATION_MS)
    );
    expect(next[0]?.id).not.toBe(current[0]?.id);
  });

  it('uses unique occurrence IDs for every generated event', () => {
    const ids = generateMockTelemetryEvents(CAPTURED_AT).map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never labels mock occurrences as native evidence', () => {
    expect(
      generateMockTelemetryEvents(CAPTURED_AT).every((event) => event.sequence === undefined)
    ).toBe(true);
  });
});

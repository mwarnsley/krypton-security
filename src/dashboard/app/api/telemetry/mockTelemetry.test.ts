import { describe, expect, it } from 'vitest';

import { generateMockTelemetryEvents } from './mockTelemetry';

const CAPTURED_AT = new Date('2026-07-19T12:00:00.000Z');

describe('generateMockTelemetryEvents', () => {
  it('returns diverse newest-first table-compatible telemetry', () => {
    const events = generateMockTelemetryEvents(CAPTURED_AT);

    expect(events).toHaveLength(4);
    expect(events.map((event) => event.timestamp)).toEqual([
      '2026-07-19T12:00:00.000Z',
      '2026-07-19T11:59:42.000Z',
      '2026-07-19T11:59:17.000Z',
      '2026-07-19T11:58:44.000Z',
    ]);
  });

  it('models the AWS credential zero-day with the required attestation', () => {
    const [zeroDayAttempt] = generateMockTelemetryEvents(CAPTURED_AT);

    expect(zeroDayAttempt).toMatchObject({
      attemptedPath: '~/.aws/credentials',
      origin_attribution: 'Ephemeral Shell Task',
      severity: 'high',
    });
  });

  it('includes an unvetted npm egress attempt', () => {
    const events = generateMockTelemetryEvents(CAPTURED_AT);

    expect(events).toContainEqual(
      expect.objectContaining({
        attemptedAction: 'workspace_boundary_network_bypass',
        processName: 'npm install',
        severity: 'critical',
      })
    );
  });

  it('includes healthy linter and build contrast events', () => {
    const events = generateMockTelemetryEvents(CAPTURED_AT);

    expect(events.filter((event) => event.enforcementStatus === 'OBSERVED')).toHaveLength(2);
    expect(events.map((event) => event.processName)).toEqual(
      expect.arrayContaining(['eslint', 'next-server'])
    );
  });
});

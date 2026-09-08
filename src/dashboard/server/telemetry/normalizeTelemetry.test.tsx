import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { normalizePersistedEvent } from './normalizeTelemetry';
import { normalizeTelemetryPayload } from '../../components/patterns/DashboardPage/DashboardPage';
import { AlertTable } from '../../components/patterns/AlertTable';

const event = {
  sequence: 42,
  id: 'native-unattributed-42',
  capturedAt: '2026-09-08T12:00:00Z',
  severity: 'high',
  category: 'workspace_boundary',
  path: '/tmp/observed-path',
  attribution: 'unattributed',
  source: 'native',
  details: {},
};

describe('native event schema across dashboard boundaries', () => {
  it('retains an unattributed native row and its cursor through client normalization', () => {
    const alert = normalizePersistedEvent(event);
    const payload = normalizeTelemetryPayload({ source: 'native', alerts: [alert], nextAfter: 42 });
    expect(payload.alerts).toEqual([alert]);
    expect(payload.alerts[0]).toMatchObject({
      targetProcessId: null,
      enforcementStatus: 'OBSERVED',
      sequence: 42,
    });
  });
  it('renders portable evidence as observed with no native isolation action', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[normalizePersistedEvent(event)]} />);
    expect(markup).toContain('/tmp/observed-path');
    expect(markup).toContain('Observed');
    expect(markup).not.toContain('Blocked &amp; Isolated');
  });
  it.each([4000, null])('preserves attributed identity parentPid %s', (parentPid) => {
    const process = { pid: 4242, startTime: 1234, executablePath: '/usr/bin/node', parentPid };
    expect(normalizePersistedEvent({ ...event, attribution: 'process', process }).process).toEqual(
      process
    );
  });
  it('rejects missing attributed parentPid', () => {
    expect(() =>
      normalizePersistedEvent({
        ...event,
        attribution: 'process',
        process: { pid: 4242, startTime: 1234, executablePath: '/bin/sh' },
      })
    ).toThrow();
  });
  it('rejects contradictory attribution', () => {
    expect(() =>
      normalizePersistedEvent({
        ...event,
        process: { pid: 4242, startTime: 1234, executablePath: '/bin/sh', parentPid: null },
      })
    ).toThrow();
  });
});

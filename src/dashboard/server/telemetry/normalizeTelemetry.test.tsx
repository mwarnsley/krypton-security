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
  it('does not turn process attribution into proof of isolation', () => {
    const process = { pid: 4242, startTime: 1234, executablePath: '/bin/sh', parentPid: 4000 };
    expect(
      normalizePersistedEvent({ ...event, attribution: 'process', process }).enforcementStatus
    ).toBe('OBSERVED');
  });
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

const mcpEvent = {
  sequence: 1,
  id: 'native-mcp-fixture',
  capturedAt: '2026-09-09T12:00:00.000Z',
  severity: 'high',
  category: 'mcp_boundary',
  path: '../outside',
  attribution: 'unattributed',
  source: 'native',
  details: { tool: 'krypton_write_file', action: 'denied' },
};
describe('native MCP evidence', () => {
  it('preserves a native denial through dashboard client normalization and table rendering', () => {
    const alert = normalizePersistedEvent(mcpEvent);
    const payload = normalizeTelemetryPayload({ source: 'native', alerts: [alert] });
    expect(payload.alerts[0]?.enforcementStatus).toBe('INTERCEPTED');
    const markup = renderToStaticMarkup(<AlertTable alerts={payload.alerts} />);
    expect(markup).toContain('krypton_write_file');
    expect(markup).toContain('Denied (actor unattributed)');
  });
  it('shows the denied tool and interception without inventing process isolation', () => {
    const row = normalizePersistedEvent(mcpEvent);
    expect(row).toMatchObject({
      attemptedAction: 'krypton_write_file',
      attemptedPath: '../outside',
      enforcementStatus: 'INTERCEPTED',
      targetProcessId: null,
    });
    expect(row.origin_attribution).not.toContain('watcher');
    expect(row.timestamp).toBe(mcpEvent.capturedAt);
  });
  it.each([
    { tool: 'shell', action: 'denied' },
    { tool: 'krypton_read_file', action: 'isolated' },
    null,
  ])('rejects malformed MCP evidence %j', (details) => {
    expect(() => normalizePersistedEvent({ ...mcpEvent, details })).toThrow();
  });
});

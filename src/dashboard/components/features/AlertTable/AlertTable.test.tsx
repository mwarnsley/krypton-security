import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, test, vi } from 'vitest';

import {
  AlertTable,
  formatAlertTimestamp,
  formatAttemptedAction,
  formatEnforcementStatus,
  requestProcessIsolation,
  type SecurityAlert,
} from './AlertTable';

const ALERT: SecurityAlert = {
  attemptedAction: 'READ_FILE',
  attemptedPath: '/project/.ssh/id_rsa',
  enforcementStatus: 'QUARANTINED',
  id: 'alert-1',
  targetProcessId: 4242,
  timestamp: '2026-07-14T12:00:00.000Z',
  triggerSignature: 'PATH_BOUNDARY_ESCAPE',
};

/**
 * Installs one deterministic isolation API response for client behavior tests.
 *
 * @param {number} status - The HTTP status returned by the mocked endpoint.
 * @param {unknown} body - The JSON response payload exposed to the client.
 * @returns {void} No value; the global fetch mock is replaced for one test.
 * @complexity O(1) time and space.
 * @example
 * mockIsolationResponse(200, { success: true, message: "Isolated" });
 * // => undefined
 */
function mockIsolationResponse(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue(body),
      ok: status >= 200 && status < 300,
      status,
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AlertTable', () => {
  test.each([
    'Timestamp',
    'Target Process ID',
    'Attempted Action',
    'Enforcement Status',
    'Actions',
  ])('renders the %s column', (columnLabel) => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain(columnLabel);
  });

  test.each([
    '2026-07-14 • 12:00:00 PM',
    String(ALERT.targetProcessId),
    'Read File',
    ALERT.attemptedPath,
    'Quarantined',
  ])('renders alert field %s', (fieldValue) => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain(fieldValue);
  });

  it('renders the telemetry empty state', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain('No security alerts detected.');
  });

  it('renders the per-process Force Isolate action', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain('Force Isolate');
  });

  it('renders the default Timestamp sort as descending', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain('Sort by Timestamp, currently descending');
  });

  it('renders client-side pagination controls', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain('aria-label="Pagination"');
  });

  it('limits the first page to ten newest alerts', () => {
    const alerts = Array.from({ length: 11 }, (_, index) => ({
      ...ALERT,
      id: `alert-${index}`,
      targetProcessId: 4_000 + index,
      timestamp: `2026-07-14T12:00:${String(index).padStart(2, '0')}.000Z`,
    }));
    const markup = renderToStaticMarkup(<AlertTable alerts={alerts} />);

    expect(markup).toContain('4010');
    expect(markup).not.toContain('4000');
  });

  it('explains process IDs in plain language', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain('PID means Process ID');
  });

  it('translates the boundary breakout action', () => {
    expect(formatAttemptedAction('filesystem_boundary_breakout')).toBe(
      'Unauthorized Workspace Escape Attempt'
    );
  });

  it('translates intercepted enforcement', () => {
    expect(formatEnforcementStatus('INTERCEPTED')).toBe('Blocked & Isolated');
  });

  it('translates autonomous rate-limit quarantine', () => {
    expect(formatEnforcementStatus('AUTOMATED_QUARANTINE')).toBe('Auto-Quarantined (Rate Limit)');
  });

  it('formats ISO telemetry dates for fast scanning', () => {
    expect(formatAlertTimestamp(ALERT.timestamp)).toBe('2026-07-14 • 12:00:00 PM');
  });

  it('provides an accessible process-specific isolation label', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain('aria-label="Force isolate process 4242"');
  });

  it('returns the verified native success message for table rendering', async () => {
    mockIsolationResponse(200, {
      success: true,
      message: 'Target child process successfully verified and isolated.',
    });

    const status = await requestProcessIsolation(4242);

    expect(status).toEqual({
      message: 'Target child process successfully verified and isolated.',
      tone: 'success',
    });
  });

  it('returns the native ownership rejection for alert rendering', async () => {
    mockIsolationResponse(403, {
      success: false,
      message: 'Isolation rejected: target process is not an authorized Krypton workspace child.',
    });

    const status = await requestProcessIsolation(4242);

    expect(status).toEqual({
      message: 'Isolation rejected: target process is not an authorized Krypton workspace child.',
      tone: 'error',
    });
  });

  it('posts the table PID to the canonical termination endpoint', async () => {
    mockIsolationResponse(200, {
      success: true,
      message: 'Target child process successfully verified and isolated.',
    });

    await requestProcessIsolation(4242);

    expect(fetch).toHaveBeenCalledWith(
      '/api/telemetry/terminate',
      expect.objectContaining({
        body: JSON.stringify({ targetProcessId: 4242 }),
      })
    );
  });

  it('renders quarantined alerts with the crimson treatment', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain('bg-rose-500/10');
  });

  it('does not emit inline styles', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).not.toContain('style=');
  });
});

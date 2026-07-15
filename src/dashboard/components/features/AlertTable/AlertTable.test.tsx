import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, test, vi } from 'vitest';

import {
  ActionsHeaderTooltipContent,
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

  test.each([String(ALERT.targetProcessId), 'Read File', ALERT.attemptedPath, 'Quarantined'])(
    'renders alert field %s',
    (fieldValue) => {
      const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

      expect(markup).toContain(fieldValue);
    }
  );

  it('renders the captured timestamp in the local device timezone', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/Indiana/Indianapolis';

    try {
      const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

      expect(markup).toContain('2026-07-14 • 08:00:00 AM');
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('preserves the captured ISO timestamp for machine-readable markup', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain(`dateTime="${ALERT.timestamp}"`);
  });

  it('renders the telemetry empty state', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain('No security alerts detected.');
  });

  it('renders one compact per-process action-menu trigger', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain('aria-label="Open actions for process 4242"');
    expect(markup).toContain('aria-haspopup="menu"');
  });

  it('removes inline action labels from the closed table row', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).not.toContain('aria-label="Force isolate process 4242"');
    expect(markup).not.toContain('aria-label="Download exploit signature for process 4242"');
  });

  it('renders structured onboarding content for both Actions options', () => {
    const markup = renderToStaticMarkup(<ActionsHeaderTooltipContent />);

    expect(markup).toContain('Force Isolate');
    expect(markup).toContain('Download Signature');
    expect(markup).toContain('my-3 border-t border-slate-800/60');
  });

  it('styles both Actions descriptions with softer supporting text', () => {
    const markup = renderToStaticMarkup(<ActionsHeaderTooltipContent />);

    expect(markup.match(/text-xs font-normal leading-relaxed text-slate-400/g)).toHaveLength(2);
  });

  it('uses distinct high-contrast treatments for both Actions headers', () => {
    const markup = renderToStaticMarkup(<ActionsHeaderTooltipContent />);

    expect(markup).toContain('mb-1 flex items-center gap-2 text-sm font-semibold text-rose-400');
    expect(markup).toContain(
      'mb-1 mt-3 flex items-center gap-2 text-sm font-semibold text-cyan-400'
    );
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

  test.each(['Target Process ID', 'Attempted Action', 'Enforcement Status', 'Actions'])(
    'renders a separate info control for %s',
    (columnLabel) => {
      const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

      expect(markup).toContain(`aria-label="Info for ${columnLabel}"`);
    }
  );

  it('keeps Timestamp free of an info control', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).not.toContain('aria-label="Info for Timestamp"');
  });

  it('uses the standardized full-width header wrapper', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);
    const headerWrappers = markup.match(
      /flex items-center justify-between gap-3 w-full primitive-header-wrapper/g
    );

    expect(headerWrappers).toHaveLength(5);
  });

  it('keeps sortable header labels from wrapping into adjacent controls', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain('min-w-0 whitespace-nowrap');
  });

  it('renders filled high-contrast help icons', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain('class="fill-cyan-300/30"');
    expect(markup).toContain('class="fill-current"');
  });

  it('keeps the help trigger outside the sortable header button', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);
    const sortButtonStart = markup.indexOf('aria-label="Sort by Target Process ID"');
    const sortButtonEnd = markup.indexOf('</button>', sortButtonStart);
    const helpButtonStart = markup.indexOf('aria-label="Info for Target Process ID"');

    expect(sortButtonStart).toBeGreaterThan(-1);
    expect(helpButtonStart).toBeGreaterThan(sortButtonEnd);
  });

  it('adds the process-termination info control to Actions', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain('aria-label="Info for Actions"');
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
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/Indiana/Indianapolis';

    try {
      expect(formatAlertTimestamp(ALERT.timestamp)).toBe('2026-07-14 • 08:00:00 AM');
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('returns malformed timestamps unchanged', () => {
    expect(formatAlertTimestamp('not-an-iso-date')).toBe('not-an-iso-date');
  });

  it('explains that Force Isolate sends SIGKILL', () => {
    const markup = renderToStaticMarkup(<ActionsHeaderTooltipContent />);

    expect(markup).toContain('termination signal (SIGKILL)');
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

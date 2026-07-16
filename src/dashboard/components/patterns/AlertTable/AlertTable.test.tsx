import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, test, vi } from 'vitest';

import {
  ActionsHeaderTooltipContent,
  AlertTable,
  formatAlertTimestamp,
  formatAttemptedAction,
  formatEnforcementStatus,
  requestProcessIsolation,
  resolveAlertPageSize,
  type SecurityAlert,
} from './AlertTable';

const ALERT: SecurityAlert = {
  attemptedAction: 'READ_FILE',
  attemptedPath: '/project/.ssh/id_rsa',
  enforcementStatus: 'QUARANTINED',
  id: 'alert-1',
  origin_attribution: '@scope/dependency-name',
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

  it('renders process origin attribution below the process ID', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain('@scope/dependency-name');
    expect(markup).toContain(
      'text-[10px] font-mono tracking-tight font-semibold bg-slate-900 border border-slate-800 text-slate-400 px-1.5 py-0.5 rounded mt-1 block max-w-max'
    );
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

  it('limits the first page to twenty-five newest alerts by default', () => {
    const alerts = Array.from({ length: 26 }, (_, index) => ({
      ...ALERT,
      id: `alert-${index}`,
      targetProcessId: 4_000 + index,
      timestamp: `2026-07-14T12:00:${String(index).padStart(2, '0')}.000Z`,
    }));
    const markup = renderToStaticMarkup(<AlertTable alerts={alerts} />);

    expect(markup).toContain('4025');
    expect(markup).not.toContain('4000');
  });

  it('renders the standardized table-footer alignment wrapper', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain(
      'flex w-full select-none flex-col items-center justify-between gap-krypton-space-4 border-t border-krypton-border-muted bg-krypton-bg-main/60 px-krypton-space-4 py-krypton-space-4 sm:flex-row'
    );
    expect(markup).toContain('Page 1 of 1 · 1 alert');
  });

  it('isolates wide table content inside its horizontal scroll wrapper', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain('w-full overflow-x-auto bg-krypton-bg-main/40');
    expect(markup).toContain(
      'w-full min-w-0 overflow-hidden rounded-krypton-radius-card border border-krypton-border-muted shadow-2xl'
    );
  });

  it('keeps the responsive footer controls aligned without clipping navigation', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain('flex w-full items-center justify-end gap-krypton-space-5 sm:w-auto');
    expect(markup).toContain('flex min-w-max items-center gap-1');
  });

  it('orders the rows-per-page selector before the navigation buttons', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup.indexOf('aria-label="Rows per page"')).toBeLessThan(
      markup.indexOf('aria-label="Pagination"')
    );
  });

  it('uses one outer outline and one footer divider without a table-shell bottom border', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).not.toContain(
      'overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40'
    );
    expect(markup).toContain('border-t border-krypton-border-muted bg-krypton-bg-main/60');
  });

  it('renders every supported rows-per-page option with 25 selected', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain('aria-label="Rows per page"');
    expect(markup.match(/<option/g)).toHaveLength(6);
    expect(markup).toContain('<option value="25" selected="">25</option>');
    expect(markup).toContain('<option value="ALL">ALL</option>');
  });

  it('styles the rows-per-page selector with the compact dark treatment', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain(
      'border border-krypton-border-muted bg-krypton-bg-surface text-slate-200'
    );
  });

  test.each([
    ['10', 4970, 10],
    ['25', 4970, 25],
    ['50', 4970, 50],
    ['75', 4970, 75],
    ['100', 4970, 100],
    ['ALL', 4970, 4970],
    ['ALL', 0, 1],
  ])('resolves page-size selection %s', (selection, totalAlerts, expectedPageSize) => {
    expect(resolveAlertPageSize(selection, totalAlerts)).toBe(expectedPageSize);
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
      /flex w-full items-center justify-between gap-krypton-space-3 primitive-header-wrapper/g
    );

    expect(headerWrappers).toHaveLength(5);
  });

  it('keeps sortable header labels from wrapping into adjacent controls', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain('inline-flex min-w-0 shrink-0');
    expect(markup).toContain(
      'gap-krypton-space-2 whitespace-nowrap rounded-krypton-radius-control'
    );
  });

  it('renders standardized high-contrast help icons', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain('lucide-info');
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

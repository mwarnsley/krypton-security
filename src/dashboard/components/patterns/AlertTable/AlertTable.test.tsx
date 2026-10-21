// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, test, vi } from 'vitest';

import {
  ActionsHeaderTooltipContent,
  AlertTable,
  formatAlertTimestamp,
  formatAttemptedAction,
  formatEnforcementStatus,
  isolationIdentityKey,
  requestProcessIsolation,
  resolveAlertActionMode,
  resolveAlertPageSize,
  SIMULATED_ALERT_ACTION_LABELS,
  type SecurityAlert,
} from './AlertTable';

const PROCESS_IDENTITY = {
  executablePath: '/usr/bin/node',
  parentPid: 4000,
  pid: 4242,
  startTime: 1_784_500_000,
} as const;

test.each([
  { ...PROCESS_IDENTITY, startTime: 10 },
  { ...PROCESS_IDENTITY, parentPid: 10 },
  { ...PROCESS_IDENTITY, executablePath: '/bin/other' },
])('does not reuse a success receipt across compound identity changes %j', (process) => {
  expect(isolationIdentityKey(process)).not.toBe(isolationIdentityKey(PROCESS_IDENTITY));
});

const ALERT: SecurityAlert = {
  attribution: 'process',
  attemptedAction: 'READ_FILE',
  attemptedPath: '/project/.ssh/id_rsa',
  enforcementStatus: 'QUARANTINED',
  id: 'alert-1',
  origin_attribution: '@scope/dependency-name',
  processName: 'node',
  process: PROCESS_IDENTITY,
  sequence: 1,
  severity: 'high',
  targetProcessId: 4242,
  timestamp: '2026-07-14T12:00:00.000Z',
  triggerSignature: 'PATH_BOUNDARY_ESCAPE',
};

const SIMULATED_ALERT: SecurityAlert = {
  attribution: 'unattributed',
  attemptedAction: ALERT.attemptedAction,
  attemptedPath: ALERT.attemptedPath,
  enforcementStatus: ALERT.enforcementStatus,
  id: 'simulated-alert-1',
  origin_attribution: ALERT.origin_attribution,
  processName: 'npm install',
  severity: ALERT.severity,
  targetProcessId: 45_600,
  timestamp: ALERT.timestamp,
  triggerSignature: ALERT.triggerSignature,
};

const UNVERIFIED_PROCESS_ALERT: SecurityAlert = {
  ...SIMULATED_ALERT,
  attribution: 'process',
  process: PROCESS_IDENTITY,
  processName: 'node',
  targetProcessId: PROCESS_IDENTITY.pid,
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
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AlertTable', () => {
  it('labels native MCP denials without showing a process isolation action', () => {
    const markup = renderToStaticMarkup(
      <AlertTable
        alerts={[
          {
            ...SIMULATED_ALERT,
            attribution: 'unattributed',
            targetProcessId: null,
            enforcementStatus: 'INTERCEPTED',
            triggerSignature: 'NATIVE_MCP_BOUNDARY',
          },
        ]}
      />
    );
    expect(markup).toContain('Blocked (Unattributed)');
    expect(markup).not.toContain('Open actions for process');
  });
  it('labels null-PID evidence as observed without claiming an actor', () => {
    const markup = renderToStaticMarkup(
      <AlertTable
        alerts={[
          {
            ...SIMULATED_ALERT,
            attribution: 'unattributed',
            targetProcessId: null,
            enforcementStatus: 'OBSERVED',
          },
        ]}
      />
    );
    expect(markup).toContain('Observed (unattributed)');
    expect(markup).not.toContain('Open actions for process');
  });

  test.each([
    'Timestamp',
    'Process ID',
    'Application / Tool',
    'Target Path',
    'Severity',
    'Security Verification',
    'Actions',
  ])('renders the %s column', (columnLabel) => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain(columnLabel);
  });

  test.each([
    String(ALERT.targetProcessId),
    ALERT.processName,
    ALERT.attemptedPath,
    ALERT.severity,
    ALERT.origin_attribution,
  ])('renders alert field %s', (fieldValue) => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain(fieldValue);
  });

  it('renders the captured timestamp in the local device timezone', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/Indiana/Indianapolis';

    try {
      const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

      expect(markup).toContain('07/14/2026 • 08:00:00 AM');
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('renders process origin attribution as a bounded attestation tag', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain('@scope/dependency-name');
    expect(markup).toContain(
      'rounded-krypton-radius-control border border-krypton-border-muted bg-krypton-bg-surface'
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

    expect(markup).toContain('aria-label="Open event actions for node"');
    expect(markup).toContain('aria-haspopup="menu"');
  });

  it('keeps the simulated row action-menu trigger enabled', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[SIMULATED_ALERT]} />);
    const triggerStart = markup.indexOf('aria-label="Open event actions for npm install"');
    const triggerEnd = markup.indexOf('</button>', triggerStart);

    expect(triggerStart).toBeGreaterThan(-1);
    expect(markup.slice(triggerStart, triggerEnd)).not.toContain('disabled=""');
  });

  it('exposes the complete simulated action menu contract', () => {
    expect(SIMULATED_ALERT_ACTION_LABELS).toEqual([
      'View Raw Event (JSON)',
      'Copy Process Details',
      'View Allowed Folder',
      'Download Threat Report',
    ]);
  });

  it.each([
    { alert: ALERT, expectedMode: 'native' },
    { alert: SIMULATED_ALERT, expectedMode: 'simulation' },
    { alert: UNVERIFIED_PROCESS_ALERT, expectedMode: 'simulation' },
  ] as const)('resolves the row action mode as $expectedMode', ({ alert, expectedMode }) => {
    expect(resolveAlertActionMode(alert)).toBe(expectedMode);
  });

  it('removes inline action labels from the closed table row', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).not.toContain('aria-label="Force isolate process 4242"');
    expect(markup).not.toContain('aria-label="Download exploit signature for process 4242"');
  });

  it('explains all four diagnostic utilities in separate icon-led sections', () => {
    const markup = renderToStaticMarkup(<ActionsHeaderTooltipContent />);
    for (const heading of [
      'View Raw Event',
      'Copy Process Details',
      'View Allowed Folder',
      'Download Threat Report',
    ])
      expect(markup).toContain(heading);
    for (const description of [
      'Inspect the raw intercepted security payload and metadata.',
      'Copy process ID, binary name, and execution parameters.',
      'Check the exact boundary directory path permitted for this session.',
      'Export a Markdown report summarizing the policy rejection and path details.',
    ])
      expect(markup).toContain(description);
    expect(markup.match(/<section/g)).toHaveLength(4);
    expect(markup.match(/<hr/g)).toHaveLength(3);
    expect(markup.match(/aria-hidden="true"/g)).toHaveLength(4);
    expect(markup).not.toMatch(/\bpro\b|paid|tiers|force stop|SIGKILL/i);
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

    expect(markup).toContain(
      'flex w-full flex-wrap items-center justify-end gap-krypton-space-5 sm:w-auto'
    );
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
    expect(markup.match(/<option/g)).toHaveLength(5);
    expect(markup).toContain('<option value="25" selected="">25</option>');
  });

  it('does not render an unbounded rows-per-page option', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).not.toContain('<option value="ALL">ALL</option>');
  });

  it('styles the rows-per-page selector with the accessible theme treatment', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain(
      'border border-krypton-control-border bg-krypton-bg-surface text-krypton-fg-secondary'
    );
  });

  test.each([
    ['10', 10],
    ['25', 25],
    ['50', 50],
    ['75', 75],
    ['100', 100],
    ['ALL', 25],
  ])('resolves page-size selection %s', (selection, expectedPageSize) => {
    expect(resolveAlertPageSize(selection)).toBe(expectedPageSize);
  });

  test.each([
    'Process ID',
    'Application / Tool',
    'Target Path',
    'Severity',
    'Security Verification',
    'Actions',
  ])('renders a separate info control for %s', (columnLabel) => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain(`aria-label="Info for ${columnLabel}"`);
  });

  it('provides Timestamp context beside its label', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[]} />);

    expect(markup).toContain('aria-label="Info for Timestamp"');
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
    const document = new DOMParser().parseFromString(markup, 'text/html');
    const sortButton = document.querySelector('button[aria-label="Sort by Process ID"]');
    const helpButton = document.querySelector('button[aria-label="Info for Process ID"]');
    expect(sortButton?.contains(helpButton)).toBe(false);
    expect(helpButton?.nextElementSibling).toBe(sortButton);
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
    expect(formatEnforcementStatus('INTERCEPTED')).toBe('Intercepted (unconfirmed)');
  });

  it('translates autonomous rate-limit quarantine', () => {
    expect(formatEnforcementStatus('AUTOMATED_QUARANTINE')).toBe('Auto-Quarantined (Rate Limit)');
  });

  it('formats ISO telemetry dates for fast scanning', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/Indiana/Indianapolis';

    try {
      expect(formatAlertTimestamp(ALERT.timestamp)).toBe('07/14/2026 • 08:00:00 AM');
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

  it('returns the verified native success message for table rendering', async () => {
    mockIsolationResponse(200, {
      success: true,
      message: 'Target child process successfully verified and isolated.',
    });

    const status = await requestProcessIsolation(PROCESS_IDENTITY);

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

    const status = await requestProcessIsolation(PROCESS_IDENTITY);

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

    await requestProcessIsolation(PROCESS_IDENTITY);

    expect(fetch).toHaveBeenCalledWith(
      '/api/telemetry/terminate',
      expect.objectContaining({
        body: JSON.stringify({ process: PROCESS_IDENTITY }),
      })
    );
  });

  it('renders high-severity alerts with the warning token treatment', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).toContain('bg-krypton-warning-amber/10');
  });

  it('does not emit inline styles', () => {
    const markup = renderToStaticMarkup(<AlertTable alerts={[ALERT]} />);

    expect(markup).not.toContain('style=');
  });
});

it('keeps one info control per header, with the Actions trigger before its label', () => {
  const document = new DOMParser().parseFromString(
    renderToStaticMarkup(<AlertTable alerts={[ALERT]} />),
    'text/html'
  );
  const headers = [...document.querySelectorAll('thead th')];
  expect(headers).toHaveLength(7);
  for (const header of headers) {
    const buttons = [...header.querySelectorAll('button')];
    expect(buttons[0]?.getAttribute('aria-label')).toMatch(/^Info for /);
    expect(header.querySelectorAll('button[aria-label^="Info for "]')).toHaveLength(1);
    if (header.textContent?.includes('Actions')) {
      expect(buttons).toHaveLength(1);
      expect(buttons[0]?.nextElementSibling?.textContent).toBe('Actions');
    } else {
      expect(buttons[1]?.getAttribute('aria-label')).toMatch(/^Sort by /);
      expect(buttons[1]?.lastElementChild?.querySelector('svg')).not.toBeNull();
    }
  }
});

it('describes Security Verification as recorded evidence without inventing a signature', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  render(<AlertTable alerts={[ALERT]} />);
  const trigger = screen.getByRole('button', { name: 'Info for Security Verification' });
  act(() => trigger.focus());
  const tooltip = document.querySelector('[role="tooltip"]');
  expect(tooltip?.textContent).toContain(
    'Shows the event source and the security evidence recorded by Krypton. Demo events are simulated.'
  );
  expect(tooltip?.textContent).not.toContain('cryptographically signed');
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  const processHelp = screen.getByRole('button', { name: 'Info for Process ID' });
  act(() => processHelp.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    'when the application is known'
  );
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('Unattributed events');
}, 30000);

it.each(['click', 'hover', 'focus'])(
  'opens the left Actions legend on %s and anchors its accessible description',
  (interaction) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    render(<AlertTable alerts={[ALERT]} />);
    const trigger = screen.getByRole('button', { name: 'Info for Actions' });
    expect(trigger.nextElementSibling?.textContent).toBe('Actions');
    if (interaction === 'click') {
      fireEvent.click(trigger);
    } else if (interaction === 'focus') {
      act(() => trigger.focus());
    } else {
      vi.useFakeTimers();
      const event = new Event('pointermove', { bubbles: true });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      fireEvent(trigger, event);
      act(() => vi.advanceTimersByTime(1));
      vi.useRealTimers();
    }
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip?.querySelectorAll('section')).toHaveLength(4);
    expect(tooltip?.textContent).toContain(
      'Inspect the raw intercepted security payload and metadata.'
    );
    expect(tooltip?.textContent).toContain(
      'Export a Markdown report summarizing the policy rejection and path details.'
    );
    expect(tooltip?.textContent).toContain(
      'Copy process ID, binary name, and execution parameters.'
    );
    expect(tooltip?.textContent).toContain(
      'Check the exact boundary directory path permitted for this session.'
    );
    expect(tooltip?.textContent).not.toMatch(/force stop|active remediation|\bpro\b|\bfree\b/i);
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip?.id);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  },
  30000
);

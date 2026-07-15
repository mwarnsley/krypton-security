import { renderToStaticMarkup } from 'react-dom/server';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SecurityAlert } from '../components/features/AlertTable';
import DashboardPage, {
  clearAlertToasts,
  dispatchAuditModeUpdate,
  scrollDashboardToTop,
  selectFreshBreakoutAlerts,
  showContainmentBreakoutToast,
} from './page';

const CURRENT_TIME_MS = Date.parse('2026-07-14T12:00:10.000Z');

const BREAKOUT_ALERT: SecurityAlert = {
  attemptedAction: 'filesystem_boundary_breakout',
  attemptedPath: '/project/private.txt',
  enforcementStatus: 'INTERCEPTED',
  id: 'breakout-1',
  origin_attribution: 'scripts/agent.ts',
  targetProcessId: 4242,
  timestamp: '2026-07-14T12:00:05.000Z',
  triggerSignature: 'NATIVE_FS_WATCH',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DashboardPage', () => {
  it('renders the security command heading', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('AegisAgent Security Command');
  });

  it('renders the active workspace protection summary', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('Active Workspace Protection');
    expect(markup).toContain(
      'Krypton maps file interactions inside your current folder directory and safely isolates malicious scripts before they can read or write data to other areas of your computer.'
    );
  });

  it('renders the labeled audit-only switch in the command header', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('Audit-Only Mode');
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-label="Info for Audit-Only Mode"');
  });

  it('renders the global toast-clearance action beside the ledger heading', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('Clear Alerts');
    expect(markup).toContain('aria-label="Clear desktop alerts"');
  });

  it('dismisses the complete Sonner toast stack', () => {
    const dismissSpy = vi.spyOn(toast, 'dismiss').mockReturnValue('dismissed');

    clearAlertToasts();

    expect(dismissSpy).toHaveBeenCalledOnce();
  });

  it('posts operator audit-mode changes to the dedicated API route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await dispatchAuditModeUpdate(true);

    expect(fetchMock).toHaveBeenCalledWith('/api/telemetry/audit-mode', {
      body: '{"auditOnly":true}',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
  });

  it('rejects unconfirmed audit-mode changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));

    await expect(dispatchAuditModeUpdate(false)).rejects.toThrow(
      'Audit mode update failed with status 502.'
    );
  });

  it('keeps the telemetry table mounted before the first poll', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('Security alert telemetry');
  });

  it('renders an initially hidden and unfocusable Back to Top control', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('aria-label="Back to top"');
    expect(markup).toContain('opacity-0 translate-y-4 pointer-events-none');
    expect(markup).toContain('tabindex="-1"');
  });

  it('applies responsive floating bounds and the robust arrow-icon size', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('fixed bottom-6 right-6 z-50');
    expect(markup).toContain('sm:bottom-8 sm:right-8');
    expect(markup).toContain('h-5 w-5');
  });

  it('smoothly scrolls the dashboard viewport to the top', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('window', { scrollTo });

    scrollDashboardToTop();

    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 0 });
  });

  it('does not emit page-owned inline styles', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);
    const markupWithoutRadixFormBridge = markup.replace(
      /<input type="checkbox" aria-hidden="true"[^>]+\/>/,
      ''
    );

    expect(markupWithoutRadixFormBridge).not.toContain('style=');
  });

  it('selects a brand-new containment breakout for notification', () => {
    const notifiedAlertIds = new Set<string>();

    const freshBreakouts = selectFreshBreakoutAlerts(
      [BREAKOUT_ALERT],
      CURRENT_TIME_MS,
      notifiedAlertIds
    );

    expect(freshBreakouts).toEqual([BREAKOUT_ALERT]);
    expect(notifiedAlertIds).toContain(BREAKOUT_ALERT.id);
  });

  it('does not replay a breakout during later polls', () => {
    const notifiedAlertIds = new Set([BREAKOUT_ALERT.id]);

    const freshBreakouts = selectFreshBreakoutAlerts(
      [BREAKOUT_ALERT],
      CURRENT_TIME_MS,
      notifiedAlertIds
    );

    expect(freshBreakouts).toEqual([]);
  });

  it('omits stale breakout alerts', () => {
    const staleAlert = {
      ...BREAKOUT_ALERT,
      timestamp: '2026-07-14T11:59:00.000Z',
    };

    const freshBreakouts = selectFreshBreakoutAlerts([staleAlert], CURRENT_TIME_MS, new Set());

    expect(freshBreakouts).toEqual([]);
  });

  it('keeps normal telemetry noise-free', () => {
    const normalAlert = {
      ...BREAKOUT_ALERT,
      attemptedAction: 'process_quarantined',
    };

    const freshBreakouts = selectFreshBreakoutAlerts([normalAlert], CURRENT_TIME_MS, new Set());

    expect(freshBreakouts).toEqual([]);
  });

  it('displays an eight-second critical toast with action and PID context', () => {
    const toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-1');

    showContainmentBreakoutToast(BREAKOUT_ALERT, false);

    expect(toastErrorSpy).toHaveBeenCalledWith('CRITICAL: Boundary Breakout', {
      description:
        'PID 4242 triggered: Unauthorized Workspace Escape Attempt. Status: Blocked & Isolated.',
      duration: 8_000,
    });
  });

  it('displays an amber learning-loop warning during Audit-Only Mode', () => {
    const toastWarningSpy = vi.spyOn(toast, 'warning').mockReturnValue('toast-warning');

    showContainmentBreakoutToast(BREAKOUT_ALERT, true);

    expect(toastWarningSpy).toHaveBeenCalledWith(
      'Learning Loop: Process attempted a folder escape but was permitted to continue running.',
      {
        description: 'PID 4242 attempted: Unauthorized Workspace Escape Attempt.',
        duration: 8_000,
      }
    );
  });

  it('removes the redundant newest-first helper copy', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).not.toContain('Newest enforcement events appear first');
  });
});

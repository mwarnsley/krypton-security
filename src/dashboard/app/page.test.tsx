import { renderToStaticMarkup } from 'react-dom/server';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SecurityAlert } from '../components/features/AlertTable';
import DashboardPage, { selectFreshBreakoutAlerts, showContainmentBreakoutToast } from './page';

const CURRENT_TIME_MS = Date.parse('2026-07-14T12:00:10.000Z');

const BREAKOUT_ALERT: SecurityAlert = {
  attemptedAction: 'filesystem_boundary_breakout',
  attemptedPath: '/project/private.txt',
  enforcementStatus: 'INTERCEPTED',
  id: 'breakout-1',
  targetProcessId: 4242,
  timestamp: '2026-07-14T12:00:05.000Z',
  triggerSignature: 'NATIVE_FS_WATCH',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardPage', () => {
  it('renders the security command heading', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('AegisAgent Security Command');
  });

  it('renders the global firewall status region', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('Global firewall status');
  });

  it('keeps the telemetry table mounted before the first poll', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('Security alert telemetry');
  });

  it('does not emit inline styles', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).not.toContain('style=');
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

    showContainmentBreakoutToast(BREAKOUT_ALERT);

    expect(toastErrorSpy).toHaveBeenCalledWith('CRITICAL: Boundary Breakout', {
      description:
        'PID 4242 triggered: Unauthorized Workspace Escape Attempt. Status: Blocked & Isolated.',
      duration: 8_000,
    });
  });

  it('removes the redundant newest-first helper copy', () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).not.toContain('Newest enforcement events appear first');
  });
});

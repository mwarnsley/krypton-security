import { renderToStaticMarkup } from 'react-dom/server';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SecurityAlert } from '../components/patterns';
import DashboardPage, {
  clearAlertToasts,
  createSimulatedThreatEvent,
  createStaticTelemetryFallback,
  dispatchAuditModeUpdate,
  EnforcementLedgerActions,
  isStandaloneDemoLocation,
  mergeTelemetryAlerts,
  scrollDashboardToTop,
  selectFreshBreakoutAlerts,
  showContainmentBreakoutToast,
  TelemetrySourceBanner,
  waitForStaticTelemetryFallback,
} from './page';

const CURRENT_TIME_MS = Date.parse('2026-07-14T12:00:10.000Z');

const BREAKOUT_ALERT: SecurityAlert = {
  attribution: 'process',
  attemptedAction: 'filesystem_boundary_breakout',
  attemptedPath: '/project/private.txt',
  enforcementStatus: 'INTERCEPTED',
  id: 'breakout-1',
  origin_attribution: 'scripts/agent.ts',
  processName: 'node',
  severity: 'high',
  targetProcessId: 4242,
  timestamp: '2026-07-14T12:00:05.000Z',
  triggerSignature: 'NATIVE_FS_WATCH',
};

afterEach(() => {
  vi.useRealTimers();
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

  it('keeps the simulation action hidden outside standalone demo mode', () => {
    const markup = renderToStaticMarkup(
      <EnforcementLedgerActions
        isDemoMode={false}
        onClearAlerts={() => {}}
        onSimulateThreatEvent={() => {}}
      />
    );

    expect(markup).not.toContain('Simulate Threat Event');
    expect(markup).toContain('Clear Alerts');
  });

  it('renders the primary simulation action before Clear Alerts in demo mode', () => {
    const markup = renderToStaticMarkup(
      <EnforcementLedgerActions
        isDemoMode
        onClearAlerts={() => {}}
        onSimulateThreatEvent={() => {}}
      />
    );

    expect(markup).toContain('bg-krypton-accent-cyan');
    expect(markup.indexOf('Simulate Threat Event')).toBeLessThan(markup.indexOf('Clear Alerts'));
  });

  it.each([
    [{ hostname: 'mwarnsley.github.io', port: '' }, true],
    [{ hostname: 'localhost', port: '3001' }, true],
    [{ hostname: 'localhost', port: '3000' }, false],
    [{ hostname: 'krypton.example.com', port: '' }, false],
  ])('detects standalone demo location %o', (location, expected) => {
    expect(isStandaloneDemoLocation(location)).toBe(expected);
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

  it('creates the critical npm install breakout used by static deployments', () => {
    const fallback = createStaticTelemetryFallback(new Date('2026-07-20T12:00:00.000Z'));

    expect(fallback.source).toBe('mock');
    expect(fallback.alerts).toHaveLength(1);
    expect(fallback.alerts[0]).toEqual(
      expect.objectContaining({
        attemptedAction: 'filesystem_boundary_breakout',
        processName: 'npm install',
        severity: 'critical',
      })
    );
  });

  it('creates the complete timestamped visitor-triggered threat event', () => {
    const simulatedAlert = createSimulatedThreatEvent(new Date('2026-07-20T12:34:56.789Z'));

    expect(simulatedAlert).toEqual(
      expect.objectContaining({
        attemptedPath: 'https://registry.npmjs.org/unvetted-postinstall',
        origin_attribution: 'unvetted-postinstall-1.0.3',
        processName: 'npm install',
        severity: 'critical',
        targetProcessId: 45_600,
        timestamp: '2026-07-20T12:34:56.789Z',
      })
    );
  });

  it('waits two seconds before enabling static demonstration telemetry', async () => {
    vi.useFakeTimers();
    const fallbackReady = waitForStaticTelemetryFallback(new AbortController().signal);
    let resolved = false;
    void fallbackReady.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(fallbackReady).resolves.toBe(true);
  });

  it('cancels the delayed fallback when telemetry polling is aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fallbackReady = waitForStaticTelemetryFallback(controller.signal);

    controller.abort();

    await expect(fallbackReady).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders the explicit unreachable-daemon demonstration banner', () => {
    const markup = renderToStaticMarkup(
      <TelemetrySourceBanner nativeDaemonReachable={false} source="mock" />
    );
    expect(markup).toContain(
      'Demonstration mode — native telemetry is unavailable. Events shown below are simulated.'
    );
  });

  it('renders the distinct degraded-native demonstration banner', () => {
    const markup = renderToStaticMarkup(
      <TelemetrySourceBanner nativeDaemonReachable source="mock" />
    );
    expect(markup).toContain(
      'Native daemon detected, but live telemetry could not be validated. Demonstration data is being shown.'
    );
  });

  it('does not render a demonstration banner for native evidence', () => {
    expect(
      renderToStaticMarkup(<TelemetrySourceBanner nativeDaemonReachable source="native" />)
    ).toBe('');
  });

  it('deduplicates cursor events and retains the newest bounded window', () => {
    const incoming = Array.from({ length: 4 }, (_, index) => ({
      ...BREAKOUT_ALERT,
      id: `alert-${String(index)}`,
      sequence: index + 1,
      timestamp: new Date(CURRENT_TIME_MS + index).toISOString(),
    }));
    const merged = mergeTelemetryAlerts([incoming[0]!], incoming, 2);
    expect(merged).toHaveLength(2);
    expect(merged.map((alert) => alert.sequence)).toEqual([4, 3]);
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

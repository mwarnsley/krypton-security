// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DashboardPage, {
  normalizeTelemetryPayload,
  showContainmentBreakoutToast,
} from './DashboardPage';
import { toast } from 'sonner';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('tracks live enforcing and audit mode across polls', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  let mode = 'active_enforcement';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        source: 'native',
        nativeDaemonReachable: true,
        activeProcessCount: 1,
        alerts: [],
        health: {
          status: 'healthy',
          mode,
          ipc: 'ready',
          ledger: 'ready',
          watcher: 'ready',
          registry: 'ready',
          notification: 'ready',
          telemetryQueue: 'ready',
        },
      }),
    }))
  );
  await act(async () => {
    render(<DashboardPage />);
  });
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(false);
  mode = 'audit_only';
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
});

it('keeps missing process counts unavailable', () => {
  expect(normalizeTelemetryPayload({ alerts: [] }).activeProcessCount).toBeNull();
});

it('never announces isolation for an unattributed observation', () => {
  const info = vi.spyOn(toast, 'info');
  showContainmentBreakoutToast(
    {
      id: 'observation',
      attribution: 'unattributed',
      targetProcessId: null,
      enforcementStatus: 'OBSERVED',
      attemptedAction: 'filesystem_boundary_breakout',
      attemptedPath: '[redacted]',
      timestamp: '2026-01-01T00:00:00Z',
      processName: 'Unknown',
      origin_attribution: 'unattributed',
      severity: 'info',
      triggerSignature: 'watcher',
    },
    false
  );
  expect(info).toHaveBeenCalledWith(
    'Observed filesystem activity',
    expect.objectContaining({
      description: 'Observation only; no process isolation is confirmed by this event.',
    })
  );
});

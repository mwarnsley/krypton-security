// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AlertTable, type SecurityAlert } from './AlertTable';

const alert: SecurityAlert = {
  id: 'mobile-alert',
  timestamp: '2026-10-15T12:00:00.000Z',
  attribution: 'unattributed',
  attemptedAction: 'read_file',
  attemptedPath: '/outside/workspace/example.txt',
  origin_attribution: 'fixture-receipt-' + 'abcdef0123456789'.repeat(12),
  processName: 'Fixture agent',
  targetProcessId: null,
  enforcementStatus: 'INTERCEPTED',
  severity: 'high',
  triggerSignature: 'NATIVE_MCP_BOUNDARY',
};

afterEach(cleanup);

describe('mobile alert stream', () => {
  it('expands the complete signature without changing denied actor attribution', () => {
    render(<AlertTable alerts={[alert]} />);
    const stream = screen.getByRole('list', { name: 'Security alert telemetry cards' });
    const summary = within(stream).getByText('Verified Signature');
    fireEvent.click(summary);
    expect(summary.closest('details')?.open).toBe(true);
    expect(within(stream).getByText(alert.origin_attribution, { selector: 'code' })).toBeTruthy();
    expect(within(stream).getByText('Denied (actor unattributed)')).toBeTruthy();
  });

  it('does not expose native isolation authority for an unattributed denial', () => {
    render(<AlertTable alerts={[alert]} />);
    const stream = screen.getByRole('list', { name: 'Security alert telemetry cards' });
    expect(within(stream).queryByRole('button', { name: /Open actions for process/ })).toBeNull();
    expect(within(stream).getByText(alert.attemptedPath)).toBeTruthy();
  });

  it('paginates cards using the same newest-first row model and single footer', () => {
    render(
      <AlertTable
        alerts={Array.from({ length: 30 }, (_, index) => ({
          ...alert,
          id: `alert-${index}`,
          processName: `Agent ${index}`,
          timestamp: `2026-10-15T12:00:${String(index).padStart(2, '0')}.000Z`,
        }))}
      />
    );
    const stream = screen.getByRole('list', { name: 'Security alert telemetry cards' });
    expect(within(stream).getAllByRole('listitem')).toHaveLength(25);
    expect(within(stream).getAllByRole('heading')[0]?.textContent).toBe('Agent 29');
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(within(stream).getAllByRole('listitem')).toHaveLength(5);
  });

  it('shows an empty mobile state without rendering empty cards', () => {
    render(<AlertTable alerts={[]} />);
    expect(screen.queryByRole('list', { name: 'Security alert telemetry cards' })).toBeNull();
    expect(screen.getByLabelText('Security alert telemetry mobile view').textContent).toContain(
      'No security alerts detected.'
    );
  });
});

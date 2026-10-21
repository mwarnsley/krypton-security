// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AlertInspector } from './AlertInspector';
import type { SecurityAlert } from '../../../types';
const alert: SecurityAlert = {
  id: 'event',
  attribution: 'unattributed',
  attemptedAction: 'read',
  attemptedPath: '/blocked/secret',
  enforcementStatus: 'INTERCEPTED',
  origin_attribution: 'native',
  processName: 'tool',
  severity: 'high',
  targetProcessId: null,
  timestamp: '2026-10-20T12:00:00Z',
  triggerSignature: 'NATIVE_MCP_BOUNDARY',
};
afterEach(cleanup);
it('shows exact retained JSON without inventing process attribution', () => {
  render(
    <AlertInspector selection={{ alert, view: 'raw' }} onClose={vi.fn()} onReturnFocus={vi.fn()} />
  );
  expect(screen.getByRole('dialog').textContent).toContain('"targetProcessId": null');
  expect(screen.getByRole('button', { name: 'Copy Retained event JSON' })).toBeTruthy();
});
it('shows the current native allowed folder rather than the blocked target', () => {
  render(
    <AlertInspector
      selection={{ alert, view: 'folder' }}
      protectedWorkspaceRoot="/safe/workspace"
      onClose={vi.fn()}
      onReturnFocus={vi.fn()}
    />
  );
  expect(screen.getByText('/safe/workspace').tagName).toBe('CODE');
  expect(screen.getByRole('dialog').textContent).not.toContain('/blocked/secret');
});
it('keeps missing folder metadata explicitly unavailable', () => {
  render(
    <AlertInspector
      selection={{ alert, view: 'folder' }}
      onClose={vi.fn()}
      onReturnFocus={vi.fn()}
    />
  );
  expect(screen.getByRole('status').textContent).toContain('Allowed folder unavailable');
  expect(screen.getByRole('dialog').textContent).not.toContain('/blocked/secret');
});
it('renders a safe serialization failure', () => {
  const malformed = { ...alert, sequence: BigInt(1) } as unknown as SecurityAlert;
  render(
    <AlertInspector
      selection={{ alert: malformed, view: 'raw' }}
      onClose={vi.fn()}
      onReturnFocus={vi.fn()}
    />
  );
  expect(screen.getByRole('alert').textContent).toBe('Event details could not be displayed.');
});

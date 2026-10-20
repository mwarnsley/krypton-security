// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AlertTable, type SecurityAlert } from './AlertTable';
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
const alert: SecurityAlert = {
  id: 'row-1',
  attribution: 'process',
  attemptedAction: 'read',
  attemptedPath: '/outside/file',
  enforcementStatus: 'OBSERVED',
  origin_attribution: 'native',
  processName: 'node',
  process: { pid: 4, parentPid: 2, executablePath: '/bin/node', startTime: 1 },
  targetProcessId: 4,
  sequence: 1,
  timestamp: '2026-10-20T12:00:00Z',
  triggerSignature: 'NATIVE_PROCESS_ADAPTER',
  severity: 'high',
};
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalScrollIntoView)
    Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});
function openMenu() {
  const view = screen.getByRole('list', { name: 'Security alert telemetry cards' });
  const trigger = within(view).getByRole('button', { name: 'Open event actions for node' });
  vi.spyOn(trigger, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 44, 44),
  ] as unknown as DOMRectList);
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return trigger;
}
it('contains only the four available utilities without commercial notices or stop requests', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<AlertTable alerts={[alert]} />);
  openMenu();
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
    'View Raw Event (JSON)',
    'Copy Process Details',
    'View Allowed Folder',
    'Download Threat Report',
  ]);
  const iconNames = ['lucide-code', 'lucide-clipboard-copy', 'lucide-folder', 'lucide-download'];
  for (const [index, item] of screen.getAllByRole('menuitem').entries()) {
    expect(item.firstElementChild?.classList.contains(iconNames[index]!)).toBe(true);
    expect(item.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(item.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  }
  expect(screen.getByRole('menu').textContent).not.toMatch(
    /force stop|\bpro\b|\bfree\b|paid|upgrade|remediation/i
  );
  expect(screen.queryByRole('status', { name: 'Event action feedback' })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
}, 30000);
it('opens raw JSON, closes with Escape and restores row focus', () => {
  render(<AlertTable alerts={[alert]} />);
  const trigger = openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'View Raw Event (JSON)' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain('"pid": 4');
  vi.useFakeTimers();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  act(() => vi.advanceTimersByTime(1));
  vi.useRealTimers();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
}, 30000);
it('shows actual current boundary metadata in the folder dialog', () => {
  render(<AlertTable alerts={[alert]} protectedWorkspaceRoot="/workspace/safe" />);
  openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'View Allowed Folder' }));
  expect(screen.getByRole('dialog').textContent).toContain('/workspace/safe');
  expect(screen.getByRole('dialog').textContent).not.toContain('/outside/file');
}, 30000);
it('copies process facts and reports clipboard failure accessibly', async () => {
  vi.stubGlobal('navigator', {
    userAgent: navigator.userAgent,
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('private-failure')) },
  });
  render(<AlertTable alerts={[alert]} />);
  openMenu();
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Process Details' }));
  });
  expect(screen.getByRole('alert').textContent).toContain('Copy unavailable');
  expect(document.body.textContent).not.toContain('private-failure');
}, 30000);

it.each([false, true])(
  'reports report-download outcome accessibly (URL failure: %s)',
  (fail) => {
    const BrowserURL = URL;
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends BrowserURL {
        static createObjectURL = vi.fn(() => {
          if (fail) throw new Error('private-url-error');
          return 'blob:owned-report';
        });
        static revokeObjectURL = revokeObjectURL;
      }
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<AlertTable alerts={[alert]} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download Threat Report' }));
    const feedback = screen.getByRole(fail ? 'alert' : 'status', { name: 'Event action feedback' });
    expect(feedback.textContent).toContain(
      fail ? 'Report download unavailable' : 'Unsigned Markdown threat report download requested'
    );
    expect(document.body.textContent).not.toContain('private-url-error');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledTimes(fail ? 0 : 1);
  },
  30000
);

it('restores focus to a visible table wrapper if polling removes the selected row', () => {
  const { rerender } = render(<AlertTable alerts={[alert]} />);
  openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'View Raw Event (JSON)' }));
  rerender(<AlertTable alerts={[]} />);
  const dialog = screen.getByRole('dialog');
  vi.useFakeTimers();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  act(() => vi.advanceTimersByTime(1));
  vi.useRealTimers();
  expect(document.activeElement).toBe(
    screen.getByRole('group', { name: 'Security activity table' })
  );
}, 30000);

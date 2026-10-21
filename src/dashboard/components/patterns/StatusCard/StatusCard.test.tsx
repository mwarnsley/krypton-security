// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, test, vi } from 'vitest';

import { StatusCard, type SystemStatus } from './StatusCard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const severityCounts = { critical: 1, high: 2, medium: 2, low: 2, info: 1 };

describe('StatusCard', () => {
  it('does not turn an unavailable registry count into zero', () => {
    expect(
      renderToStaticMarkup(
        <StatusCard
          severityCounts={severityCounts}
          alertCount={8}
          activeProcessCount={null}
          systemStatus="degraded"
        />
      )
    ).toContain('Unavailable');
  });
  test.each<[SystemStatus, string]>([
    ['operational', 'Operational'],
    ['degraded', 'Degraded'],
    ['offline', 'Offline'],
  ])('renders the %s status label', (systemStatus, expectedLabel) => {
    const markup = renderToStaticMarkup(
      <StatusCard
        severityCounts={severityCounts}
        alertCount={8}
        activeProcessCount={4}
        systemStatus={systemStatus}
      />
    );

    expect(markup).toContain(expectedLabel);
  });

  it('renders the active process count', () => {
    const markup = renderToStaticMarkup(
      <StatusCard
        severityCounts={severityCounts}
        alertCount={8}
        activeProcessCount={12}
        systemStatus="operational"
      />
    );

    expect(markup).toContain('>12<');
  });

  test.each<[SystemStatus, string]>([
    ['operational', 'Active (v1.0.3)'],
    ['degraded', 'Degraded'],
    ['offline', 'Unavailable'],
  ])('renders truthful containment metrics for %s health', (systemStatus, expected) => {
    const markup = renderToStaticMarkup(
      <StatusCard
        severityCounts={severityCounts}
        alertCount={8}
        activeProcessCount={systemStatus === 'offline' ? null : 2}
        systemStatus={systemStatus}
      />
    );
    expect(markup).toContain('Boundary containment');
    expect(markup).toContain(expected);
    expect(markup).toContain('Supervised MCP children');
    expect(markup).toContain('Relative traversal &amp; symlink lock');
    if (systemStatus !== 'operational') expect(markup).not.toContain('Active (');
  });

  test.each([
    [0, '0', '0'],
    [8, '8', '8'],
    [9999, '9,999', '9,999'],
    [10000, '10K', '10,000'],
    [1250000, '1.3M', '1,250,000'],
  ])('formats %i alerts with an exact accessible count', (alertCount, compact, exact) => {
    const markup = renderToStaticMarkup(
      <StatusCard
        severityCounts={severityCounts}
        activeProcessCount={2}
        alertCount={alertCount}
        systemStatus="operational"
      />
    );
    expect(markup).toContain('Intercepted alerts');
    expect(markup).toContain(`title="${exact}"`);
    expect(markup).toContain(`aria-label="${exact} intercepted alerts"`);
    expect(markup).toContain(`>${compact}</dd>`);
    expect(markup).toContain('Total policy rejections');
  });

  test.each([-1, NaN, Infinity, 1.5])(
    'does not format invalid alert count %s as healthy data',
    (alertCount) => {
      const markup = renderToStaticMarkup(
        <StatusCard
          severityCounts={severityCounts}
          activeProcessCount={2}
          alertCount={alertCount}
          systemStatus="operational"
        />
      );
      expect(markup).toContain('Unavailable');
      expect(markup).not.toContain('title="NaN"');
    }
  );

  it('does not emit inline styles', () => {
    const markup = renderToStaticMarkup(
      <StatusCard
        severityCounts={severityCounts}
        alertCount={8}
        activeProcessCount={1}
        systemStatus="degraded"
      />
    );

    expect(markup).not.toContain('style=');
  });
});

it.each(['focus', 'hover', 'tap'])(
  'reveals severity details on %s and dismisses with Escape',
  (interaction) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    render(
      <StatusCard
        activeProcessCount={2}
        alertCount={12008}
        severityCounts={{ critical: 12000, high: 3, medium: 2, low: 2, info: 1 }}
        systemStatus="operational"
      />
    );
    expect(document.querySelector('ul[aria-label="Alert counts by severity"]')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Info for Intercepted alerts' });
    if (interaction === 'focus') {
      act(() => trigger.focus());
    } else if (interaction === 'tap') {
      const tap = () => {
        for (const type of ['pointerdown', 'pointerup']) {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'pointerType', { value: 'touch' });
          fireEvent(trigger, event);
        }
        fireEvent.click(trigger);
      };
      tap();
      expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
      tap();
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      tap();
    } else {
      vi.useFakeTimers();
      const pointerMove = new Event('pointermove', { bubbles: true });
      Object.defineProperty(pointerMove, 'pointerType', { value: 'mouse' });
      fireEvent(trigger, pointerMove);
      act(() => vi.advanceTimersByTime(1));
      vi.useRealTimers();
    }
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    const tooltip = document.querySelector('[role="tooltip"]')!;
    for (const [severity, count] of [
      ['Critical', '12,000'],
      ['High', '3'],
      ['Medium', '2'],
      ['Low', '2'],
      ['Info', '1'],
    ]) {
      expect(tooltip.textContent).toContain(`${severity}: ${count}`);
    }
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  },
  // Floating UI layout runs inside jsdom; bound interaction work for shared CI.
  30000
);

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KryptonTooltip } from './KryptonTooltip';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('KryptonTooltip', () => {
  it('preserves the accessible trigger element', () => {
    const markup = renderToStaticMarkup(
      <KryptonTooltip content="Refresh telemetry">
        <button aria-label="Refresh" type="button" />
      </KryptonTooltip>
    );

    expect(markup).toContain('aria-label="Refresh"');
  });

  it.each(['accent', 'neutral', 'legend'] as const)(
    'describes the focused trigger and dismisses %s content with Escape',
    (tone) => {
      render(
        <KryptonTooltip tone={tone} content="Recorded local event details">
          <button type="button">Details</button>
        </KryptonTooltip>
      );
      const trigger = screen.getByRole('button', { name: 'Details' });
      act(() => trigger.focus());
      const tooltip = screen.getByRole('tooltip');
      expect(tooltip.textContent).toBe('Recorded local event details');
      expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(screen.queryByRole('tooltip')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    }
  );

  it.each(['neutral', 'legend'] as const)('toggles %s content without relying on hover', (tone) => {
    render(
      <KryptonTooltip tone={tone} size="legend" content="Read-only diagnostics">
        <button type="button">Details</button>
      </KryptonTooltip>
    );
    const trigger = screen.getByRole('button', { name: 'Details' });
    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip').textContent).toBe('Read-only diagnostics');
    fireEvent.click(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InfoTooltip } from './InfoTooltip';

beforeEach(() => {
  // jsdom has no layout observer; tooltip positioning is outside these interaction checks.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('InfoTooltip', () => {
  it('preserves keyboard focus when the information trigger is activated', () => {
    render(
      <InfoTooltip
        appearance="unboxed"
        size="compact"
        tone="neutral"
        content="Inspect event details, view raw JSON payload, or review folder containment boundaries."
        label="Actions"
      />
    );
    const trigger = screen.getByRole('button', { name: 'Info for Actions' });

    act(() => trigger.focus());
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip?.id);
    expect(tooltip?.textContent).toContain('view raw JSON payload');
    fireEvent.click(trigger);

    expect(document.activeElement).toBe(trigger);
  });

  it('does not activate the enclosing control when information is selected', () => {
    const onClick = vi.fn();
    render(
      <div onClick={onClick}>
        <InfoTooltip content="Explains process termination." label="Actions" />
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Info for Actions' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a separate accessible information trigger', () => {
    const markup = renderToStaticMarkup(
      <InfoTooltip content="Explains process termination." label="Actions" />
    );

    expect(markup).toContain('aria-label="Info for Actions"');
  });

  it('renders the standardized Lucide information icon', () => {
    const markup = renderToStaticMarkup(
      <InfoTooltip content="Explains process termination." label="Actions" />
    );

    expect(markup).toContain('lucide-info');
  });

  it('uses the shared pointer cursor contract for its trigger', () => {
    const markup = renderToStaticMarkup(
      <InfoTooltip content="Explains process termination." label="Actions" />
    );

    expect(markup).toContain('cursor-pointer');
  });
});

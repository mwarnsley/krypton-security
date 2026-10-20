// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MoreVertical } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KryptonIconButton } from './KryptonIconButton';

afterEach(cleanup);

describe('KryptonIconButton', () => {
  it('activates once without submitting its enclosing form', () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <KryptonIconButton
          aria-label="Open event actions"
          icon={<MoreVertical />}
          onClick={onClick}
        />
      </form>
    );
    const trigger = screen.getByRole('button', { name: 'Open event actions' });
    expect(trigger.getAttribute('type')).toBe('button');
    expect(trigger.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('does not activate when disabled', () => {
    const onClick = vi.fn();
    render(
      <KryptonIconButton
        disabled
        aria-label="Unavailable event action"
        icon={<MoreVertical />}
        onClick={onClick}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Unavailable event action' });
    fireEvent.click(trigger);
    expect(onClick).not.toHaveBeenCalled();
    trigger.focus();
    expect(document.activeElement).not.toBe(trigger);
  });
  it('normalizes the Lucide icon and forwards the accessible label', () => {
    const markup = renderToStaticMarkup(
      <KryptonIconButton aria-label="Open actions" icon={<MoreVertical />} size="sm" />
    );

    expect(markup).toContain('aria-label="Open actions"');
    expect(markup).toContain('width="14"');
  });

  it('uses the semantic destructive token contract', () => {
    const markup = renderToStaticMarkup(
      <KryptonIconButton aria-label="Delete alert" icon={<MoreVertical />} variant="destructive" />
    );

    expect(markup).toContain('bg-krypton-alert-rose');
  });

  it('exposes explicit pointer and disabled cursor states', () => {
    const markup = renderToStaticMarkup(
      <KryptonIconButton aria-label="Delete alert" disabled icon={<MoreVertical />} />
    );

    expect(markup).toContain('cursor-pointer');
    expect(markup).toContain('disabled:cursor-not-allowed');
    expect(markup).not.toContain('disabled:pointer-events-none');
  });
});

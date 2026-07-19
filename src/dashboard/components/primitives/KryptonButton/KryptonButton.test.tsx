import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { KryptonButton } from './KryptonButton';

describe('KryptonButton', () => {
  it('renders both structural icon slots', () => {
    const markup = renderToStaticMarkup(
      <KryptonButton
        endIcon={<span data-icon="end" />}
        startIcon={<span data-icon="start" />}
        variant="primary"
      >
        Protect
      </KryptonButton>
    );

    expect(markup).toContain('data-icon="start"');
    expect(markup).toContain('data-icon="end"');
  });

  it.each([
    ['primary', 'bg-krypton-accent-cyan'],
    ['secondary', 'border-krypton-border-muted'],
    ['destructive', 'bg-krypton-alert-rose'],
    ['link', 'text-krypton-accent-cyan'],
  ] as const)('maps the %s variant to a semantic token', (variant, tokenClass) => {
    const markup = renderToStaticMarkup(<KryptonButton variant={variant}>Protect</KryptonButton>);

    expect(markup).toContain(tokenClass);
  });
});

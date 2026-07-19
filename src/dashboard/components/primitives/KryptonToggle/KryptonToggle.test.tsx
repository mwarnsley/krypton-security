import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { KryptonToggle } from './KryptonToggle';

describe('KryptonToggle', () => {
  it('renders an accessible warning switch', () => {
    const markup = renderToStaticMarkup(
      <KryptonToggle aria-label="Audit mode" variant="warning" />
    );

    expect(markup).toContain('role="switch"');
    expect(markup).toContain('data-[state=checked]:bg-krypton-warning-amber');
    expect(markup).toContain('border-krypton-border-muted');
  });
});

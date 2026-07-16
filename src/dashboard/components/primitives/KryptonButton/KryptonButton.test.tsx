import { Shield } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { KryptonButton } from './KryptonButton';

describe('KryptonButton', () => {
  it('renders a non-submitting primary button with structural icon content', () => {
    const markup = renderToStaticMarkup(
      <KryptonButton startIcon={<Shield />} variant="primary">
        Protect
      </KryptonButton>
    );

    expect(markup).toContain('type="button"');
    expect(markup).toContain('bg-krypton-accent-cyan');
  });
});

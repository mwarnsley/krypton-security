import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { KryptonInput } from './KryptonInput';

describe('KryptonInput', () => {
  it('renders token-driven focus styling', () => {
    const markup = renderToStaticMarkup(<KryptonInput aria-label="Filter alerts" />);

    expect(markup).toContain('focus-visible:border-krypton-accent-cyan');
  });
});

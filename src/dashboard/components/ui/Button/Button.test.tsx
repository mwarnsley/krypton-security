import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';

describe('Button', () => {
  it('defaults to a non-submitting button', () => {
    const markup = renderToStaticMarkup(<Button>Navigate</Button>);

    expect(markup).toContain('type="button"');
  });

  it('forwards accessible labels', () => {
    const markup = renderToStaticMarkup(<Button aria-label="Next page">Next</Button>);

    expect(markup).toContain('aria-label="Next page"');
  });
});

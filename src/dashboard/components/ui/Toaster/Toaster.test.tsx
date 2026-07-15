import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Toaster } from './Toaster';

describe('Toaster', () => {
  it('renders the accessible Sonner notification region', () => {
    const markup = renderToStaticMarkup(<Toaster limit={3} theme="dark" />);

    expect(markup).toContain('aria-label="Notifications alt+T"');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Switch } from './Switch';

describe('Switch', () => {
  it('renders an accessible unchecked switch by default', () => {
    const markup = renderToStaticMarkup(<Switch aria-label="Audit-Only Mode" />);

    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="false"');
  });

  it('exposes the checked Radix state', () => {
    const markup = renderToStaticMarkup(<Switch aria-label="Audit-Only Mode" checked />);

    expect(markup).toContain('data-state="checked"');
  });
});

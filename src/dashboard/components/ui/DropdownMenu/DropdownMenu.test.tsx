import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DropdownMenu, DropdownMenuTrigger } from './DropdownMenu';

describe('DropdownMenu', () => {
  it('renders an accessible trigger through the shared primitive', () => {
    const markup = renderToStaticMarkup(
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Alert actions">Open</DropdownMenuTrigger>
      </DropdownMenu>
    );

    expect(markup).toContain('aria-label="Alert actions"');
    expect(markup).toContain('aria-haspopup="menu"');
  });
});

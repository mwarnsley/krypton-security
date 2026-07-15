import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InfoTooltip } from './InfoTooltip';

describe('InfoTooltip', () => {
  it('renders a separate accessible information trigger', () => {
    const markup = renderToStaticMarkup(
      <InfoTooltip content="Explains process termination." label="Actions" />
    );

    expect(markup).toContain('aria-label="Info for Actions"');
  });

  it('renders a filled high-contrast information icon', () => {
    const markup = renderToStaticMarkup(
      <InfoTooltip content="Explains process termination." label="Actions" />
    );

    expect(markup).toContain('class="fill-cyan-300/30"');
    expect(markup).toContain('class="fill-current"');
  });
});

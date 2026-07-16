import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { KryptonTooltip } from './KryptonTooltip';

describe('KryptonTooltip', () => {
  it('preserves the accessible trigger element', () => {
    const markup = renderToStaticMarkup(
      <KryptonTooltip content="Refresh telemetry">
        <button aria-label="Refresh" type="button" />
      </KryptonTooltip>
    );

    expect(markup).toContain('aria-label="Refresh"');
  });
});

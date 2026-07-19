import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { KryptonTypography } from './KryptonTypography';

describe('KryptonTypography', () => {
  it('maps the h1 variant to semantic heading markup', () => {
    const markup = renderToStaticMarkup(
      <KryptonTypography variant="h1">Security events</KryptonTypography>
    );

    expect(markup).toContain('<h1');
    expect(markup).toContain('Security events');
  });

  it('maps technical readouts to the mono tracking token', () => {
    const markup = renderToStaticMarkup(
      <KryptonTypography variant="mono-code">PID 4242</KryptonTypography>
    );

    expect(markup).toContain('font-mono');
    expect(markup).toContain('tracking-krypton-mono');
  });
});

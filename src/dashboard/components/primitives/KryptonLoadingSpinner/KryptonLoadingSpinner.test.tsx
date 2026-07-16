import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { KryptonLoadingSpinner } from './KryptonLoadingSpinner';

describe('KryptonLoadingSpinner', () => {
  it('announces active telemetry loading', () => {
    const markup = renderToStaticMarkup(
      <KryptonLoadingSpinner label="Loading telemetry" size="lg" />
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('Loading telemetry');
  });
});

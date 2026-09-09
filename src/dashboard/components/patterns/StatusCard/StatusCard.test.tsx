import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, test } from 'vitest';

import { StatusCard, type SystemStatus } from './StatusCard';

describe('StatusCard', () => {
  it('does not turn an unavailable registry count into zero', () => {
    expect(
      renderToStaticMarkup(<StatusCard activeProcessCount={null} systemStatus="degraded" />)
    ).toContain('Unavailable');
  });
  test.each<[SystemStatus, string]>([
    ['operational', 'Operational'],
    ['degraded', 'Degraded'],
    ['offline', 'Offline'],
  ])('renders the %s status label', (systemStatus, expectedLabel) => {
    const markup = renderToStaticMarkup(
      <StatusCard activeProcessCount={4} systemStatus={systemStatus} />
    );

    expect(markup).toContain(expectedLabel);
  });

  it('renders the active process count', () => {
    const markup = renderToStaticMarkup(
      <StatusCard activeProcessCount={12} systemStatus="operational" />
    );

    expect(markup).toContain('>12<');
  });

  it('does not emit inline styles', () => {
    const markup = renderToStaticMarkup(
      <StatusCard activeProcessCount={1} systemStatus="degraded" />
    );

    expect(markup).not.toContain('style=');
  });
});

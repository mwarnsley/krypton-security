import { MoreVertical } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { KryptonIconButton } from './KryptonIconButton';

describe('KryptonIconButton', () => {
  it('normalizes the Lucide icon and forwards the accessible label', () => {
    const markup = renderToStaticMarkup(
      <KryptonIconButton aria-label="Open actions" icon={<MoreVertical />} size="sm" />
    );

    expect(markup).toContain('aria-label="Open actions"');
    expect(markup).toContain('width="14"');
  });
});

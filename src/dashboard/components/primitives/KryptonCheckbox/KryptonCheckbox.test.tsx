import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { KryptonCheckbox } from './KryptonCheckbox';

describe('KryptonCheckbox', () => {
  it('renders a labelled native checkbox', () => {
    const markup = renderToStaticMarkup(<KryptonCheckbox label="Select alert" />);

    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('Select alert');
    expect(markup).toContain('rounded-krypton-radius-control');
  });
});

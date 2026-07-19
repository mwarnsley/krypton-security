import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { KryptonSelect } from './KryptonSelect';

describe('KryptonSelect', () => {
  it('renders every structured option', () => {
    const markup = renderToStaticMarkup(
      <KryptonSelect
        aria-label="Rows per page"
        options={[
          { label: '25', value: '25' },
          { label: 'ALL', value: 'ALL' },
        ]}
        value="25"
      />
    );

    expect(markup.match(/<option/g)).toHaveLength(2);
    expect(markup).toContain('border-krypton-border-muted');
  });
});

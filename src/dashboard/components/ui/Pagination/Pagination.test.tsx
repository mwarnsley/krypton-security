import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Pagination, PaginationContent, PaginationItem, PaginationLink } from './Pagination';

describe('Pagination', () => {
  it('renders an accessible navigation landmark', () => {
    const markup = renderToStaticMarkup(<Pagination />);

    expect(markup).toContain('aria-label="Pagination"');
  });

  it('marks the selected page as current', () => {
    const markup = renderToStaticMarkup(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationLink isActive>1</PaginationLink>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    );

    expect(markup).toContain('aria-current="page"');
  });
});

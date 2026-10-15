import type { ColumnDef } from '@tanstack/react-table';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { KryptonDataTable, resolveKryptonPageSize } from './KryptonDataTable';

interface AssetRow {
  readonly id: string;
  readonly name: string;
}

const COLUMNS: readonly ColumnDef<AssetRow>[] = [{ accessorKey: 'name', header: 'Asset name' }];

const PAGINATION = {
  onChange: vi.fn(),
  onPageSizeSelectionChange: vi.fn(),
  pageSizeSelection: '25',
  state: { pageIndex: 0, pageSize: 25 },
} as const;

describe('KryptonDataTable', () => {
  it('supplies only the sorted current page to the compact renderer', () => {
    const renderMobileRow = vi.fn((row: { original: AssetRow }) => row.original.name);
    renderToStaticMarkup(
      <KryptonDataTable
        caption="Protected assets"
        columns={[...COLUMNS]}
        data={['a', 'b', 'c', 'd'].map((name) => ({ id: name, name }))}
        emptyMessage="No assets."
        itemLabel="asset"
        pagination={{ ...PAGINATION, state: { pageIndex: 1, pageSize: 2 } }}
        sorting={{ onChange: vi.fn(), state: [{ id: 'name', desc: true }] }}
        renderMobileRow={renderMobileRow}
      />
    );
    expect(renderMobileRow.mock.calls.map(([row]) => row.original.name)).toEqual(['b', 'a']);
  });

  it('does not invoke the compact renderer for an empty page', () => {
    const renderMobileRow = vi.fn(() => 'Unexpected card');
    const markup = renderToStaticMarkup(
      <KryptonDataTable
        caption="Protected assets"
        columns={[...COLUMNS]}
        data={[]}
        emptyMessage="No assets."
        itemLabel="asset"
        pagination={PAGINATION}
        renderMobileRow={renderMobileRow}
      />
    );
    expect(renderMobileRow).not.toHaveBeenCalled();
    expect(markup).toContain('Protected assets mobile view');
  });

  it('renders the shared grid, row count, selector, and navigation cluster', () => {
    const markup = renderToStaticMarkup(
      <KryptonDataTable
        caption="Protected assets"
        columns={[...COLUMNS]}
        data={[{ id: 'asset-1', name: 'Sandbox' }]}
        emptyMessage="No assets."
        getRowId={(asset) => asset.id}
        itemLabel="asset"
        pagination={PAGINATION}
      />
    );

    expect(markup).toContain('1 asset');
    expect(markup).toContain('aria-label="Rows per page"');
    expect(markup).toContain('aria-label="Pagination"');
  });

  it('rejects the removed all-rows selector', () => {
    expect(resolveKryptonPageSize('ALL', 500)).toBe(10);
  });

  it('uses consistent middle alignment and tokenized padding for headers and cells', () => {
    const markup = renderToStaticMarkup(
      <KryptonDataTable
        caption="Protected assets"
        columns={[...COLUMNS]}
        data={[{ id: 'asset-1', name: 'Sandbox' }]}
        emptyMessage="No assets."
        getRowId={(asset) => asset.id}
        itemLabel="asset"
        pagination={PAGINATION}
      />
    );

    expect(markup.match(/px-krypton-space-4 py-krypton-space-3 align-middle/g)).toHaveLength(2);
  });

  it('centers the empty message horizontally and vertically in a stable table body', () => {
    const markup = renderToStaticMarkup(
      <KryptonDataTable
        caption="Protected assets"
        columns={[...COLUMNS]}
        data={[]}
        emptyMessage="No assets."
        itemLabel="asset"
        pagination={PAGINATION}
      />
    );

    expect(markup).toContain('flex h-48 w-full items-center justify-center');
    expect(markup).toContain('px-krypton-space-4 py-krypton-space-3 align-middle');
  });
});

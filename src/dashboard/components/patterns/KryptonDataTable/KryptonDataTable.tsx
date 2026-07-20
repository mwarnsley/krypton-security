'use client';

import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useId, useMemo } from 'react';

import {
  KryptonButton,
  KryptonIconButton,
  KryptonSelect,
  type KryptonSelectOption,
  KryptonTypography,
} from '../../primitives';

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 75, 100] as const;

export interface KryptonDataTablePagination {
  /** Receives TanStack pagination updates from navigation and page-size controls. */
  readonly onChange: OnChangeFn<PaginationState>;

  /** Receives the raw selector value so consumers can preserve the `ALL` state. */
  readonly onPageSizeSelectionChange: (selection: string) => void;

  /** The supported numeric selector values. @default [10, 25, 50, 75, 100] */
  readonly pageSizeOptions?: readonly number[];

  /** The controlled numeric value or `ALL` sentinel displayed by the selector. */
  readonly pageSizeSelection: string;

  /** The controlled TanStack page index and page size. */
  readonly state: PaginationState;
}

export interface KryptonDataTableSorting {
  /** Receives TanStack sorting updates from column controls. */
  readonly onChange: OnChangeFn<SortingState>;

  /** The controlled TanStack sorting descriptors. */
  readonly state: SortingState;
}

export interface KryptonDataTableProps<TData extends RowData> {
  /** The accessible table caption hidden visually above the grid. */
  readonly caption: string;

  /** The typed TanStack column definitions rendered by the shared grid. */
  readonly columns: ColumnDef<TData>[];

  /** The immutable row collection supplied to TanStack. */
  readonly data: TData[];

  /** The message shown when the current row model is empty. */
  readonly emptyMessage: string;

  /** Optional stable row identity resolver. */
  readonly getRowId?: (originalRow: TData, index: number, parent?: unknown) => string;

  /** Optional semantic data attributes attached to each rendered row. */
  readonly getRowDataAttributes?: (
    row: TData
  ) => Readonly<Record<`data-${string}`, string | undefined>>;

  /** The singular noun used in the left-aligned row count. */
  readonly itemLabel: string;

  /** The controlled pagination state and handlers shown in the footer. */
  readonly pagination: KryptonDataTablePagination;

  /** Optional controlled TanStack sorting state and handler. */
  readonly sorting?: KryptonDataTableSorting;
}

/**
 * Resolves a table selector value into a safe positive page size.
 *
 * @param {string} selection - A configured numeric value or the `ALL` sentinel.
 * @param {number} totalRowCount - The complete number of supplied rows.
 * @param {readonly number[]} pageSizeOptions - The numeric values accepted by the table.
 * @returns {number} A positive page size or the first configured fallback.
 * @example
 * resolveKryptonPageSize('ALL', 42, [10, 25]);
 * // => 42
 */
export function resolveKryptonPageSize(
  selection: string,
  _totalRowCount: number,
  pageSizeOptions: readonly number[] = DEFAULT_PAGE_SIZE_OPTIONS
): number {
  const numericSelection = Number(selection);
  const fallback = pageSizeOptions[0] ?? 25;

  return pageSizeOptions.includes(numericSelection) ? numericSelection : fallback;
}

/**
 * Selects a compact set of numbered page controls around the current page.
 *
 * @param {number} activePageIndex - The zero-based current page index.
 * @param {number} pageCount - The total number of available pages.
 * @returns {Array<number | "ellipsis-left" | "ellipsis-right">} Page indexes and range markers.
 * @example
 * getKryptonPageTokens(4, 10);
 * // => [0, "ellipsis-left", 3, 4, 5, "ellipsis-right", 9]
 */
export function getKryptonPageTokens(
  activePageIndex: number,
  pageCount: number
): Array<number | 'ellipsis-left' | 'ellipsis-right'> {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, pageIndex) => pageIndex);
  }

  const tokens: Array<number | 'ellipsis-left' | 'ellipsis-right'> = [0];

  if (activePageIndex > 2) {
    tokens.push('ellipsis-left');
  }

  for (
    let pageIndex = Math.max(1, activePageIndex - 1);
    pageIndex <= Math.min(pageCount - 2, activePageIndex + 1);
    pageIndex += 1
  ) {
    tokens.push(pageIndex);
  }

  if (activePageIndex < pageCount - 3) {
    tokens.push('ellipsis-right');
  }

  tokens.push(pageCount - 1);
  return tokens;
}

/**
 * Renders a generic TanStack data grid with shared Krypton table chrome.
 *
 * @param {KryptonDataTableProps<TData>} props - Typed data, columns, and controlled state seams.
 * @returns {React.JSX.Element} A responsive table with row counts and pagination controls.
 * @example
 * <KryptonDataTable caption="Assets" columns={columns} data={assets} emptyMessage="No assets." itemLabel="asset" pagination={pagination} />
 * // => renders the shared paginated table shell
 */
export function KryptonDataTable<TData extends RowData>(
  props: KryptonDataTableProps<TData>
): React.JSX.Element {
  const {
    caption,
    columns,
    data,
    emptyMessage,
    getRowDataAttributes,
    getRowId,
    itemLabel,
    pagination,
    sorting,
  } = props;
  const pageSizeSelectId = useId();
  // TanStack Table intentionally returns mutable callbacks that React Compiler cannot memoize safely.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onPaginationChange: pagination.onChange,
    ...(getRowId === undefined ? {} : { getRowId }),
    ...(sorting === undefined ? {} : { onSortingChange: sorting.onChange }),
    state: {
      pagination: pagination.state,
      sorting: sorting?.state ?? [],
    },
  });
  const rows = table.getRowModel().rows;
  const pageCount = Math.max(1, table.getPageCount());
  const activePageIndex = Math.min(table.getState().pagination.pageIndex, pageCount - 1);
  const pageTokens = getKryptonPageTokens(activePageIndex, pageCount);
  const pageSizeOptions = pagination.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS;
  const selectOptions = useMemo<KryptonSelectOption[]>(
    () => [
      ...pageSizeOptions.map((pageSize) => ({ label: String(pageSize), value: String(pageSize) })),
    ],
    [pageSizeOptions]
  );
  const totalRowCount = table.getPrePaginationRowModel().rows.length;
  const countLabel = totalRowCount === 1 ? itemLabel : `${itemLabel}s`;

  return (
    <div
      className="w-full min-w-0 overflow-hidden rounded-krypton-radius-card border border-krypton-border-muted shadow-2xl shadow-black/20"
      data-component="krypton-data-table"
    >
      <div className="w-full overflow-x-auto bg-krypton-bg-main/40">
        <table className="min-w-full border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-krypton-border-muted bg-krypton-bg-surface/95 text-xs uppercase tracking-wider text-slate-400">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    className="px-krypton-space-4 py-krypton-space-3 font-semibold"
                    key={header.id}
                    scope="col"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-krypton-border-muted">
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr
                  className="bg-krypton-bg-main/40 transition-colors hover:bg-krypton-bg-surface/70"
                  key={row.id}
                  {...getRowDataAttributes?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td className="px-krypton-space-4 py-krypton-space-3 align-top" key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-krypton-space-4 py-12 text-center" colSpan={columns.length}>
                  <KryptonTypography>{emptyMessage}</KryptonTypography>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <footer className="flex w-full select-none flex-col items-center justify-between gap-krypton-space-4 border-t border-krypton-border-muted bg-krypton-bg-main/60 px-krypton-space-4 py-krypton-space-4 sm:flex-row">
        <div className="whitespace-nowrap" role="status">
          <KryptonTypography>
            Page {activePageIndex + 1} of {pageCount} · {totalRowCount} {countLabel}
          </KryptonTypography>
        </div>
        <div className="flex w-full items-center justify-end gap-krypton-space-5 sm:w-auto">
          <div className="flex shrink-0 items-center gap-krypton-space-2">
            <label className="whitespace-nowrap text-xs text-slate-400" htmlFor={pageSizeSelectId}>
              Rows per page
            </label>
            <KryptonSelect
              aria-label="Rows per page"
              id={pageSizeSelectId}
              onChange={(event) => {
                const nextSelection = event.currentTarget.value;
                pagination.onPageSizeSelectionChange(nextSelection);
                pagination.onChange({
                  pageIndex: 0,
                  pageSize: resolveKryptonPageSize(nextSelection, data.length, pageSizeOptions),
                });
              }}
              options={selectOptions}
              value={pagination.pageSizeSelection}
            />
          </div>
          <nav aria-label="Pagination" className="flex min-w-max items-center gap-1">
            <KryptonIconButton
              aria-label="Go to previous page"
              disabled={!table.getCanPreviousPage()}
              icon={<ChevronLeft />}
              onClick={() => table.previousPage()}
              size="sm"
              variant="link"
            />
            {pageTokens.map((pageToken) =>
              typeof pageToken === 'number' ? (
                <KryptonButton
                  aria-current={pageToken === activePageIndex ? 'page' : undefined}
                  aria-label={`Go to page ${pageToken + 1}`}
                  key={pageToken}
                  onClick={() => table.setPageIndex(pageToken)}
                  size="sm"
                  variant={pageToken === activePageIndex ? 'secondary' : 'link'}
                >
                  {pageToken + 1}
                </KryptonButton>
              ) : (
                <span
                  aria-hidden="true"
                  className="inline-flex h-8 w-8 items-center justify-center text-slate-500"
                  key={pageToken}
                >
                  <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                </span>
              )
            )}
            <KryptonIconButton
              aria-label="Go to next page"
              disabled={!table.getCanNextPage()}
              icon={<ChevronRight />}
              onClick={() => table.nextPage()}
              size="sm"
              variant="link"
            />
          </nav>
        </div>
      </footer>
    </div>
  );
}

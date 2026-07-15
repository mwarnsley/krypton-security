import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import type { ComponentProps, HTMLAttributes } from 'react';

import { Button, type ButtonProps } from '../Button';

export type PaginationProps = ComponentProps<'nav'>;
export type PaginationContentProps = ComponentProps<'ul'>;
export type PaginationItemProps = ComponentProps<'li'>;
export type PaginationLinkProps = Omit<ButtonProps, 'size'> & {
  /** Marks the link representing the active table page. */
  readonly isActive?: boolean;
};
export type PaginationControlProps = Omit<ButtonProps, 'children'>;
export type PaginationEllipsisProps = HTMLAttributes<HTMLSpanElement>;

/**
 * Provides an accessible navigation landmark for a paginated collection.
 *
 * @param {PaginationProps} props - Native navigation landmark attributes.
 * @returns {React.JSX.Element} A labelled pagination navigation region.
 * @example
 * <Pagination><PaginationContent /></Pagination>
 * // => renders a pagination navigation landmark
 */
export function Pagination(props: PaginationProps): React.JSX.Element {
  const { className = '', ...navigationProps } = props;

  return (
    <nav
      aria-label="Pagination"
      className={`flex w-full justify-center ${className}`}
      role="navigation"
      {...navigationProps}
    />
  );
}

/**
 * Groups the ordered pagination controls.
 *
 * @param {PaginationContentProps} props - Native list attributes.
 * @returns {React.JSX.Element} A compact horizontal control list.
 * @example
 * <PaginationContent><PaginationItem /></PaginationContent>
 * // => renders a horizontal pagination list
 */
export function PaginationContent(props: PaginationContentProps): React.JSX.Element {
  const { className = '', ...listProps } = props;

  return <ul className={`flex flex-row items-center gap-1 ${className}`} {...listProps} />;
}

/**
 * Wraps one control in the pagination list.
 *
 * @param {PaginationItemProps} props - Native list-item attributes.
 * @returns {React.JSX.Element} One pagination list item.
 * @example
 * <PaginationItem><PaginationLink>1</PaginationLink></PaginationItem>
 * // => renders one page control
 */
export function PaginationItem(props: PaginationItemProps): React.JSX.Element {
  return <li {...props} />;
}

/**
 * Renders an individual numbered pagination control.
 *
 * @param {PaginationLinkProps} props - Button attributes and active-page state.
 * @returns {React.JSX.Element} A numbered page button.
 * @example
 * <PaginationLink isActive>1</PaginationLink>
 * // => renders the active page button
 */
export function PaginationLink(props: PaginationLinkProps): React.JSX.Element {
  const { 'aria-label': ariaLabel, isActive = false, ...buttonProps } = props;

  return (
    <Button
      aria-current={isActive ? 'page' : undefined}
      aria-label={ariaLabel}
      size="icon"
      variant={isActive ? 'outline' : 'ghost'}
      {...buttonProps}
    />
  );
}

/**
 * Renders the previous-page control.
 *
 * @param {PaginationControlProps} props - Button attributes for table navigation.
 * @returns {React.JSX.Element} A labelled previous-page button.
 * @example
 * <PaginationPrevious onClick={goBack} />
 * // => renders the previous-page control
 */
export function PaginationPrevious(props: PaginationControlProps): React.JSX.Element {
  return (
    <Button aria-label="Go to previous page" size="sm" {...props}>
      <ChevronLeft aria-hidden="true" className="h-4 w-4" />
      <span className="hidden sm:inline">Previous</span>
    </Button>
  );
}

/**
 * Renders the next-page control.
 *
 * @param {PaginationControlProps} props - Button attributes for table navigation.
 * @returns {React.JSX.Element} A labelled next-page button.
 * @example
 * <PaginationNext onClick={goForward} />
 * // => renders the next-page control
 */
export function PaginationNext(props: PaginationControlProps): React.JSX.Element {
  return (
    <Button aria-label="Go to next page" size="sm" {...props}>
      <span className="hidden sm:inline">Next</span>
      <ChevronRight aria-hidden="true" className="h-4 w-4" />
    </Button>
  );
}

/**
 * Indicates a skipped range of numbered pages.
 *
 * @param {PaginationEllipsisProps} props - Native span attributes.
 * @returns {React.JSX.Element} A screen-reader-labelled page-range ellipsis.
 * @example
 * <PaginationEllipsis />
 * // => renders an ellipsis between distant page buttons
 */
export function PaginationEllipsis(props: PaginationEllipsisProps): React.JSX.Element {
  const { className = '', ...spanProps } = props;

  return (
    <span
      aria-hidden="true"
      className={`flex h-9 w-9 items-center justify-center text-slate-500 ${className}`}
      {...spanProps}
    >
      <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      <span className="sr-only">More pages</span>
    </span>
  );
}

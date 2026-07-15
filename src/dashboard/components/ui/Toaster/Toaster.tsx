'use client';

import { Toaster as SonnerToaster, type ToasterProps as SonnerToasterProps } from 'sonner';

export type ToasterProps = Omit<SonnerToasterProps, 'visibleToasts'> & {
  /** The maximum number of live notifications visible in the stack. */
  readonly limit: number;
};

/**
 * Renders the shared Sonner notification region with an explicit stack limit.
 *
 * @param {ToasterProps} props - Sonner configuration and the visible stack limit.
 * @returns {React.JSX.Element} A globally mounted, stack-limited toast region.
 * @example
 * <Toaster limit={3} position="top-right" theme="dark" />
 * // => renders no more than three simultaneous notifications
 */
export function Toaster(props: ToasterProps): React.JSX.Element {
  const { limit, ...sonnerProps } = props;

  return <SonnerToaster visibleToasts={limit} {...sonnerProps} />;
}

'use client';

import { Toaster as SonnerToaster, type ToasterProps as SonnerToasterProps } from 'sonner';

export type ToasterProps = Omit<SonnerToasterProps, 'visibleToasts'> & {
  /** The maximum number of live notifications visible in the stack. */
  readonly limit: number;
};

export function Toaster(props: ToasterProps): React.JSX.Element {
  const { limit, ...sonnerProps } = props;

  return <SonnerToaster visibleToasts={limit} {...sonnerProps} />;
}

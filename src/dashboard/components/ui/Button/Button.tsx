import { Slot } from '@radix-ui/react-slot';
import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'destructive' | 'ghost' | 'outline';
export type ButtonSize = 'default' | 'icon' | 'sm';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Renders the child element while preserving the button treatment. */
  readonly asChild?: boolean;

  /** Controls the compactness of the button treatment. */
  readonly size?: ButtonSize;

  /** Controls the semantic visual treatment of the button. */
  readonly variant?: ButtonVariant;
};

const BASE_CLASSES =
  'inline-flex shrink-0 touch-manipulation items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-50';

const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
  destructive:
    'border border-rose-400/30 bg-rose-600 text-white shadow-sm shadow-rose-950/40 hover:bg-rose-500',
  ghost: 'text-slate-300 hover:bg-slate-800 hover:text-white',
  outline:
    'border border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-600 hover:bg-slate-800 hover:text-white',
};

const SIZE_CLASSES: Readonly<Record<ButtonSize, string>> = {
  default: 'h-10 px-4 py-2',
  icon: 'h-9 w-9',
  sm: 'h-8 px-3 text-xs',
};

/**
 * Renders the shared Shadcn-style interactive button primitive.
 *
 * @param {ButtonProps} props - Native button attributes and visual options.
 * @returns {React.JSX.Element} An accessible button or slotted child control.
 * @example
 * <Button variant="outline">Previous</Button>
 * // => renders a compact outlined button
 */
export function Button(props: ButtonProps): React.JSX.Element {
  const {
    asChild = false,
    className,
    size = 'default',
    type = 'button',
    variant = 'outline',
    ...buttonProps
  } = props;
  const Component = asChild ? Slot : 'button';

  return (
    <Component
      className={clsx(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className)}
      type={asChild ? undefined : type}
      {...buttonProps}
    />
  );
}

import type { LucideProps } from 'lucide-react';
import { cloneElement, type ButtonHTMLAttributes, type ReactElement } from 'react';

import type { KryptonButtonVariant } from '../KryptonButton';

export type KryptonIconButtonSize = 'sm' | 'md' | 'lg';

export interface KryptonIconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'className'
> {
  /** The Lucide icon element rendered as the control's sole visual child. */
  readonly icon: ReactElement<LucideProps>;

  /** Controls the square hit area and icon dimensions. @default "md" */
  readonly size?: KryptonIconButtonSize;

  /** Controls the semantic visual treatment of the control. @default "secondary" */
  readonly variant?: KryptonButtonVariant;
}

const BASE_CLASSES =
  'inline-flex shrink-0 touch-manipulation items-center justify-center rounded-krypton-radius-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krypton-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-krypton-bg-main disabled:pointer-events-none disabled:opacity-50';

const VARIANT_CLASSES: Readonly<Record<KryptonButtonVariant, string>> = {
  primary:
    'border border-krypton-accent-cyan bg-krypton-accent-cyan text-slate-950 hover:bg-cyan-300',
  secondary:
    'border border-krypton-border-muted bg-krypton-bg-surface text-slate-300 hover:bg-slate-800 hover:text-white',
  destructive: 'border border-krypton-alert-rose/40 bg-rose-600 text-white hover:bg-rose-500',
  link: 'text-krypton-accent-cyan hover:bg-cyan-400/10 hover:text-cyan-200',
};

const SIZE_CLASSES: Readonly<Record<KryptonIconButtonSize, string>> = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
};

const ICON_SIZES: Readonly<Record<KryptonIconButtonSize, number>> = {
  sm: 14,
  md: 16,
  lg: 20,
};

/**
 * Renders a labelled square control around one Lucide icon element.
 *
 * @param {KryptonIconButtonProps} props - Native button behavior and fixed icon options.
 * @returns {React.JSX.Element} An accessible icon-only button.
 * @example
 * <KryptonIconButton aria-label="Open menu" icon={<MoreVertical />} />
 * // => renders a medium secondary icon button
 */
export function KryptonIconButton(props: KryptonIconButtonProps): React.JSX.Element {
  const { icon, size = 'md', type = 'button', variant = 'secondary', ...buttonProps } = props;

  return (
    <button
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]}`}
      type={type}
      {...buttonProps}
    >
      {cloneElement(icon, { 'aria-hidden': true, size: ICON_SIZES[size] })}
    </button>
  );
}

import { Slot } from '@radix-ui/react-slot';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type KryptonButtonVariant = 'primary' | 'secondary' | 'destructive' | 'link';
export type KryptonButtonSize = 'sm' | 'md' | 'lg';

export interface KryptonButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className'
> {
  /** Renders a single child element while preserving the Krypton button treatment. */
  readonly asChild?: boolean;

  /** Optional content anchored before the button label. */
  readonly startIcon?: ReactNode;

  /** Optional content anchored after the button label. */
  readonly endIcon?: ReactNode;

  /** Controls the fixed height and horizontal padding of the control. @default "md" */
  readonly size?: KryptonButtonSize;

  /** Controls the semantic visual treatment of the control. @default "secondary" */
  readonly variant?: KryptonButtonVariant;
}

const BASE_CLASSES =
  'inline-flex min-w-0 shrink-0 touch-manipulation items-center justify-center gap-krypton-space-2 whitespace-nowrap rounded-krypton-radius-control font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krypton-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-krypton-bg-main disabled:pointer-events-none disabled:opacity-50';

const VARIANT_CLASSES: Readonly<Record<KryptonButtonVariant, string>> = {
  primary:
    'border border-krypton-accent-cyan bg-krypton-accent-cyan text-slate-950 shadow-sm shadow-cyan-950/40 hover:bg-cyan-300',
  secondary:
    'border border-krypton-border-muted bg-krypton-bg-surface text-slate-200 hover:border-slate-600 hover:bg-slate-800 hover:text-white',
  destructive:
    'border border-krypton-alert-rose/40 bg-rose-600 text-white shadow-sm shadow-rose-950/40 hover:bg-rose-500',
  link: 'text-krypton-accent-cyan underline-offset-4 hover:text-cyan-200 hover:underline',
};

const SIZE_CLASSES: Readonly<Record<KryptonButtonSize, string>> = {
  sm: 'h-8 px-krypton-space-3 text-xs',
  md: 'h-10 px-krypton-space-4 text-sm',
  lg: 'h-11 px-krypton-space-5 text-sm',
};

/**
 * Renders the closed-variant Krypton action primitive.
 *
 * @param {KryptonButtonProps} props - Native button behavior plus semantic layout options.
 * @returns {React.JSX.Element} A styled native button or Radix slotted child.
 * @example
 * <KryptonButton startIcon={<Shield />} variant="primary">Protect</KryptonButton>
 * // => renders a primary action with a leading icon
 */
export function KryptonButton(props: KryptonButtonProps): React.JSX.Element {
  const {
    asChild = false,
    children,
    endIcon,
    size = 'md',
    startIcon,
    type = 'button',
    variant = 'secondary',
    ...buttonProps
  } = props;
  const Component = asChild ? Slot : 'button';

  return (
    <Component
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]}`}
      type={asChild ? undefined : type}
      {...buttonProps}
    >
      {startIcon ? (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {startIcon}
        </span>
      ) : null}
      {children}
      {endIcon ? (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {endIcon}
        </span>
      ) : null}
    </Component>
  );
}

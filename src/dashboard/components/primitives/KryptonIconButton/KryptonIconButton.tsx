import type { LucideProps } from 'lucide-react';
import { cloneElement, type ButtonHTMLAttributes, type ReactElement } from 'react';

import type { KryptonButtonVariant } from '../KryptonButton';

export type KryptonIconButtonVariant = KryptonButtonVariant | 'plain';

export type KryptonIconButtonSize = 'sm' | 'md' | 'lg';

export interface KryptonIconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'className' | 'style'
> {
  /** The Lucide icon element rendered as the control's sole visual child. */
  readonly icon: ReactElement<LucideProps>;

  /** Controls the square hit area and icon dimensions. @default "md" */
  readonly size?: KryptonIconButtonSize;

  /** Controls the semantic visual treatment of the control. @default "secondary" */
  readonly variant?: KryptonIconButtonVariant;
}

const BASE_CLASSES =
  'inline-flex shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-krypton-radius-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krypton-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-krypton-bg-main disabled:cursor-not-allowed disabled:opacity-50';

const VARIANT_CLASSES: Readonly<Record<KryptonIconButtonVariant, string>> = {
  plain: 'border-0 bg-transparent text-krypton-fg-muted hover:text-krypton-fg-primary',
  primary:
    'border border-krypton-accent-cyan bg-krypton-accent-cyan text-krypton-bg-main hover:bg-krypton-accent-cyan/90',
  secondary:
    'border border-krypton-control-border bg-krypton-bg-surface text-krypton-fg-secondary hover:border-krypton-focus-ring hover:bg-krypton-control-hover hover:text-krypton-fg-primary',
  destructive:
    'border border-krypton-alert-rose bg-krypton-alert-rose text-krypton-bg-main hover:bg-krypton-alert-rose/90',
  link: 'text-krypton-accent-cyan hover:bg-krypton-accent-cyan/10 hover:text-krypton-accent-cyan/90',
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

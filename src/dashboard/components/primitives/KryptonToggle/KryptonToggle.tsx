'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import { forwardRef } from 'react';

export interface KryptonToggleProps extends Omit<
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>,
  'className' | 'style'
> {
  /** Controls the toggle track and thumb dimensions. @default "md" */
  readonly size?: 'sm' | 'md';

  /** Chooses the semantic checked-state color. @default "active" */
  readonly variant?: 'active' | 'warning';
}

const ROOT_SIZE_CLASSES: Readonly<Record<NonNullable<KryptonToggleProps['size']>, string>> = {
  sm: 'h-5 w-9',
  md: 'h-6 w-11',
};

const THUMB_SIZE_CLASSES: Readonly<Record<NonNullable<KryptonToggleProps['size']>, string>> = {
  sm: 'h-4 w-4 data-[state=checked]:translate-x-4',
  md: 'h-5 w-5 data-[state=checked]:translate-x-5',
};

const VARIANT_CLASSES: Readonly<Record<NonNullable<KryptonToggleProps['variant']>, string>> = {
  active: 'data-[state=checked]:bg-krypton-accent-cyan',
  warning: 'data-[state=checked]:bg-krypton-warning-amber',
};

/**
 * Renders the semantic Krypton binary toggle on top of Radix Switch.
 *
 * @param {KryptonToggleProps} props - Radix state behavior plus fixed visual options.
 * @returns {React.JSX.Element} A keyboard-accessible switch control.
 * @example
 * <KryptonToggle aria-label="Audit mode" variant="warning" />
 * // => renders an amber checked-state toggle
 */
export const KryptonToggle = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  KryptonToggleProps
>(function KryptonToggle(
  { size = 'md', variant = 'active', ...toggleProps },
  ref
): React.JSX.Element {
  return (
    <SwitchPrimitive.Root
      className={`peer inline-flex shrink-0 cursor-pointer items-center rounded-krypton-radius-full border-2 border-krypton-border-muted bg-krypton-bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krypton-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-krypton-bg-main disabled:cursor-not-allowed disabled:opacity-50 ${ROOT_SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]}`}
      ref={ref}
      {...toggleProps}
    >
      <SwitchPrimitive.Thumb
        className={`pointer-events-none block translate-x-0 rounded-krypton-radius-full bg-slate-100 shadow-lg transition-transform ${THUMB_SIZE_CLASSES[size]}`}
      />
    </SwitchPrimitive.Root>
  );
});

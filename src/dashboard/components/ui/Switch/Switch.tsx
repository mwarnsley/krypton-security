'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import clsx from 'clsx';
import { forwardRef } from 'react';

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

/**
 * Renders the shared Shadcn-style Radix switch primitive.
 *
 * @param {SwitchProps} props - Radix switch state, accessibility, and event properties.
 * @returns {React.JSX.Element} An accessible binary switch with a visible state thumb.
 * @example
 * <Switch aria-label="Audit-Only Mode" checked={true} />
 * // => renders a checked audit-mode switch
 */
export const Switch = forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  function Switch({ className, ...props }, ref): React.JSX.Element {
    return (
      <SwitchPrimitive.Root
        className={clsx(
          'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-cyan-500',
          className
        )}
        ref={ref}
        {...props}
      >
        <SwitchPrimitive.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
      </SwitchPrimitive.Root>
    );
  }
);

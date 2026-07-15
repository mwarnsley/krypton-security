'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import clsx from 'clsx';
import { forwardRef } from 'react';

export type TooltipContentProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>;

export const Tooltip = TooltipPrimitive.Root;
export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * Renders shared Shadcn-style tooltip content above its trigger by default.
 *
 * @param {TooltipContentProps} props - Radix tooltip placement, content, and style properties.
 * @returns {React.JSX.Element} Portaled tooltip content with a directional arrow.
 * @example
 * <TooltipContent>Explains the control.</TooltipContent>
 * // => renders an accessible tooltip above its trigger
 */
export const TooltipContent = forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(function TooltipContent(
  { className, side = 'top', sideOffset = 8, ...props },
  ref
): React.JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        className={clsx(
          'z-50 max-w-72 rounded-lg border border-cyan-400/30 bg-slate-950 px-3 py-2 text-left text-xs font-medium normal-case leading-5 tracking-normal text-slate-100 shadow-2xl shadow-black/60 data-[state=closed]:animate-out data-[state=delayed-open]:animate-in data-[state=instant-open]:animate-in',
          className
        )}
        ref={ref}
        side={side}
        sideOffset={sideOffset}
        {...props}
      >
        {props.children}
        <TooltipPrimitive.Arrow className="fill-slate-950" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});

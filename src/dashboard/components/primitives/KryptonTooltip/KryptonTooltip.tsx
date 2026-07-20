'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';

export type KryptonTooltipSize = 'sm' | 'md' | 'lg';

export interface KryptonTooltipProps {
  /** The interactive element that owns the tooltip relationship. */
  readonly children: ReactElement;

  /** The explanatory content rendered in the glassmorphic surface. */
  readonly content: ReactNode;

  /** The accessible placement of the tooltip relative to its trigger. @default "top" */
  readonly side?: 'top' | 'right' | 'bottom' | 'left';

  /** Controls the fixed content width and padding tier. @default "md" */
  readonly size?: KryptonTooltipSize;
}

const SIZE_CLASSES: Readonly<Record<KryptonTooltipSize, string>> = {
  sm: 'max-w-56 px-krypton-space-2 py-krypton-space-1',
  md: 'max-w-72 px-krypton-space-3 py-krypton-space-2',
  lg: 'max-w-80 p-krypton-space-4 sm:p-krypton-space-5',
};

/**
 * Renders an instant-open, instant-dismiss Radix tooltip with Krypton glass styling.
 *
 * @param {KryptonTooltipProps} props - Trigger, content, and placement options.
 * @returns {React.JSX.Element} A portaled accessible tooltip relationship.
 * @example
 * <KryptonTooltip content="Refresh telemetry"><button>Refresh</button></KryptonTooltip>
 * // => renders an immediately responsive tooltip
 */
export function KryptonTooltip(props: KryptonTooltipProps): React.JSX.Element {
  const { children, content, side = 'top', size = 'md' } = props;

  return (
    <TooltipPrimitive.Provider delayDuration={0} disableHoverableContent skipDelayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className={`z-50 rounded-krypton-radius-card border border-krypton-accent-cyan/30 bg-krypton-bg-main/90 text-left text-xs font-medium leading-5 text-krypton-fg-primary shadow-2xl shadow-krypton-shadow backdrop-blur-md ${SIZE_CLASSES[size]}`}
            side={side}
            sideOffset={8}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-krypton-bg-main" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

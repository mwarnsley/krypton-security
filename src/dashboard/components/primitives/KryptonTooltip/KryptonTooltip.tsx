'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { useState, type ReactElement, type ReactNode } from 'react';

export type KryptonTooltipTone = 'accent' | 'neutral' | 'legend';

export type KryptonTooltipSize = 'sm' | 'md' | 'lg' | 'compact' | 'legend';

export interface KryptonTooltipProps {
  /** The interactive element that owns the tooltip relationship. */
  readonly children: ReactElement;

  /** The explanatory content rendered in the glassmorphic surface. */
  readonly content: ReactNode;

  /** The accessible placement of the tooltip relative to its trigger. @default "top" */
  readonly side?: 'top' | 'right' | 'bottom' | 'left';

  /** Semantic surface; legend adds a sectioned action card. @default "accent" */
  readonly tone?: KryptonTooltipTone;

  /** Controls the fixed content width and padding tier. @default "md" */
  readonly size?: KryptonTooltipSize;
}

const SIZE_CLASSES: Readonly<Record<KryptonTooltipSize, string>> = {
  legend: 'max-w-sm p-3.5',
  compact: 'max-w-80 p-2.5',
  sm: 'max-w-56 px-krypton-space-2 py-krypton-space-1',
  md: 'max-w-72 px-krypton-space-3 py-krypton-space-2',
  lg: 'max-w-80 p-krypton-space-4 sm:p-krypton-space-5',
};

const NEUTRAL_SIZE_CLASSES: Readonly<Record<KryptonTooltipSize, string>> = {
  ...SIZE_CLASSES,
  md: 'max-w-72 p-krypton-space-3',
};

export function KryptonTooltip(props: KryptonTooltipProps): React.JSX.Element {
  const { children, content, side = 'top', size = 'md', tone = 'accent' } = props;
  const [summaryOpen, setSummaryOpen] = useState(false);
  const supportsToggle = tone !== 'accent';
  const surfaceClasses =
    tone === 'neutral'
      ? `border-krypton-border-muted bg-krypton-bg-surface text-krypton-fg-secondary shadow-xl ${NEUTRAL_SIZE_CLASSES[size]}`
      : tone === 'legend'
        ? `border-krypton-border-muted bg-krypton-bg-main/95 text-krypton-fg-body shadow-2xl ${SIZE_CLASSES[size]}`
        : `border-krypton-accent-cyan/30 bg-krypton-bg-main/90 text-krypton-fg-primary shadow-2xl backdrop-blur-md ${SIZE_CLASSES[size]}`;

  return (
    <TooltipPrimitive.Provider
      delayDuration={0}
      disableHoverableContent={!supportsToggle}
      skipDelayDuration={0}
    >
      <TooltipPrimitive.Root
        {...(supportsToggle ? { open: summaryOpen, onOpenChange: setSummaryOpen } : {})}
      >
        <TooltipPrimitive.Trigger
          asChild
          onPointerDown={supportsToggle ? (event) => event.preventDefault() : undefined}
          onClick={
            supportsToggle
              ? (event) => {
                  event.preventDefault();
                  setSummaryOpen((current) => !current);
                }
              : undefined
          }
        >
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className={`z-50 rounded-krypton-radius-card border text-left text-xs font-medium leading-5 shadow-krypton-shadow ${surfaceClasses}`}
            side={side}
            align="center"
            sideOffset={8}
          >
            {content}
            <TooltipPrimitive.Arrow
              className={tone === 'neutral' ? 'fill-krypton-bg-surface' : 'fill-krypton-bg-main'}
            />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

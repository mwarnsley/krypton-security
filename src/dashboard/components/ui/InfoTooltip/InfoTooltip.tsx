'use client';

import type { ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../Tooltip';

export interface InfoTooltipProps {
  /** The concise control or column name used in the trigger's accessible label. */
  readonly label: string;

  /** The plain-language explanation or structured onboarding content displayed above the trigger. */
  readonly content: ReactNode;

  /** Optional utility classes applied to the portaled tooltip content shell. */
  readonly contentClassName?: string;
}

/**
 * Renders a filled information icon with an instant hover-and-focus tooltip.
 *
 * @param {InfoTooltipProps} props - The accessible label and explanatory copy.
 * @returns {React.JSX.Element} A standalone info trigger that never activates parent controls.
 * @example
 * <InfoTooltip label="Actions" content="Explains process termination." />
 * // => renders a filled info icon with an above-positioned tooltip
 */
export function InfoTooltip(props: InfoTooltipProps): React.JSX.Element {
  const { content, contentClassName, label } = props;

  return (
    <TooltipProvider delayDuration={0} disableHoverableContent skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={`Info for ${label}`}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-cyan-200 transition-colors hover:bg-cyan-400/15 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            onClick={(event) => {
              event.stopPropagation();
              event.currentTarget.blur();
            }}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4 text-cyan-100"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="fill-cyan-300/30" cx="12" cy="12" r="10" />
              <path d="M12 11v6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              <circle className="fill-current" cx="12" cy="7.5" r="1.25" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent className={contentClassName} side="top">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

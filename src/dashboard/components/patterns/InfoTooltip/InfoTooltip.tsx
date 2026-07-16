import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { KryptonIconButton, KryptonTooltip, type KryptonTooltipSize } from '../../primitives';

export interface InfoTooltipProps {
  /** The concise control or column name used in the trigger's accessible label. */
  readonly label: string;

  /** The plain-language explanation or structured onboarding content displayed above the trigger. */
  readonly content: ReactNode;

  /** Controls the fixed tooltip content width and padding tier. @default "md" */
  readonly size?: KryptonTooltipSize;
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
  const { content, label, size = 'md' } = props;

  return (
    <KryptonTooltip content={content} size={size}>
      <KryptonIconButton
        aria-label={`Info for ${label}`}
        icon={<Info />}
        onClick={(event) => {
          event.stopPropagation();
          event.currentTarget.blur();
        }}
        size="sm"
        variant="link"
      />
    </KryptonTooltip>
  );
}

import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  KryptonIconButton,
  KryptonTooltip,
  type KryptonTooltipTone,
  type KryptonTooltipSize,
} from '../../primitives';

export interface InfoTooltipProps {
  /** The concise control or column name used in the trigger's accessible label. */
  readonly label: string;

  /** The plain-language explanation or structured onboarding content displayed above the trigger. */
  readonly content: ReactNode;

  /** Unboxed information icon; preserves the focus ring and full hit area. */
  readonly appearance?: 'default' | 'unboxed';

  /** Semantic tooltip surface; neutral suits metric summaries. */
  readonly tone?: KryptonTooltipTone;

  /** Controls the fixed tooltip content width and padding tier. @default "md" */
  readonly size?: KryptonTooltipSize;
}

export function InfoTooltip(props: InfoTooltipProps): React.JSX.Element {
  const { content, label, size = 'md', tone = 'accent', appearance = 'default' } = props;

  return (
    <KryptonTooltip content={content} size={size} tone={tone}>
      <KryptonIconButton
        aria-label={`Info for ${label}`}
        icon={<Info />}
        onClick={(event) => {
          event.stopPropagation();
        }}
        size="sm"
        variant={appearance === 'unboxed' ? 'plain' : 'link'}
      />
    </KryptonTooltip>
  );
}

'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { KryptonButton } from '../KryptonButton';

export interface KryptonCodeBlockProps {
  /** The exact, selectable text copied without shell evaluation or modification. */
  readonly code: string;
  /** The visible heading and accessible copy button name. */
  readonly label: string;
}

export function KryptonCodeBlock({ code, label }: KryptonCodeBlockProps): React.JSX.Element {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const copy = async (): Promise<void> => {
    setStatus('copying');
    try {
      await navigator.clipboard.writeText(code);
      setStatus('copied');
    } catch (error: unknown) {
      void error;
      setStatus('failed');
    }
  };
  return (
    <div className="my-3 min-w-0 rounded-krypton-radius-control border border-krypton-border-muted bg-krypton-bg-main p-krypton-space-3">
      <div className="flex flex-wrap items-center justify-between gap-krypton-space-2">
        <span className="text-xs font-semibold text-krypton-fg-secondary">{label}</span>
        <KryptonButton
          aria-label={`Copy ${label}`}
          disabled={status === 'copying'}
          onClick={() => {
            void copy();
          }}
          size="sm"
          startIcon={status === 'copied' ? <Check /> : <Copy />}
        >
          Copy
        </KryptonButton>
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-sm leading-6 text-krypton-fg-primary">
        <code>{code}</code>
      </pre>
      <span role="status" className="text-xs text-krypton-fg-secondary">
        {status === 'copied'
          ? 'Copied'
          : status === 'failed'
            ? 'Copy unavailable. Select the text and copy it manually.'
            : ''}
      </span>
    </div>
  );
}

import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';

export interface KryptonSelectOption {
  /** The label presented in the native option list. */
  readonly label: string;

  /** The stable value emitted by the select control. */
  readonly value: string;
}

export interface KryptonSelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'children' | 'className' | 'size' | 'style'
> {
  /** The closed list of values presented by the selector. */
  readonly options: readonly KryptonSelectOption[];

  /** Controls the fixed form-control height. @default "sm" */
  readonly size?: 'sm' | 'md';
}

const SIZE_CLASSES: Readonly<Record<NonNullable<KryptonSelectProps['size']>, string>> = {
  sm: 'h-8 pl-2.5 pr-7 py-krypton-space-1 text-xs',
  md: 'h-10 pl-2.5 pr-7 py-krypton-space-1 text-xs',
};

export const KryptonSelect = forwardRef<HTMLSelectElement, KryptonSelectProps>(
  function KryptonSelect({ options, size = 'sm', ...selectProps }, ref): React.JSX.Element {
    return (
      <span className="relative inline-flex shrink-0">
        <select
          className={`cursor-pointer appearance-none rounded-krypton-radius-control border border-krypton-control-border bg-krypton-bg-surface text-krypton-fg-secondary focus-visible:border-krypton-focus-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krypton-focus-ring disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASSES[size]}`}
          ref={ref}
          {...selectProps}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-krypton-space-2 top-1/2 h-4 w-4 -translate-y-1/2 text-krypton-fg-secondary"
        />
      </span>
    );
  }
);

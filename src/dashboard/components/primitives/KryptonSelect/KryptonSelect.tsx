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
  sm: 'h-8 pl-3 pr-8 text-xs',
  md: 'h-10 pl-3 pr-9 text-sm',
};

/**
 * Renders an accessible native selector with the polished Krypton dark treatment.
 *
 * @param {KryptonSelectProps} props - Native selection behavior and structured options.
 * @returns {React.JSX.Element} A forwarded native select control.
 * @example
 * <KryptonSelect aria-label="Rows per page" options={[{ label: "25", value: "25" }]} />
 * // => renders a compact dark selector
 */
export const KryptonSelect = forwardRef<HTMLSelectElement, KryptonSelectProps>(
  function KryptonSelect({ options, size = 'sm', ...selectProps }, ref): React.JSX.Element {
    return (
      <select
        className={`cursor-pointer appearance-auto rounded-krypton-radius-control border border-krypton-border-muted bg-krypton-bg-surface text-slate-200 focus-visible:border-krypton-accent-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krypton-accent-cyan/30 disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASSES[size]}`}
        ref={ref}
        {...selectProps}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
);

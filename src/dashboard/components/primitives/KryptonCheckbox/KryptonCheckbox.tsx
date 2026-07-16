import { Check } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes } from 'react';

export interface KryptonCheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'size' | 'type'
> {
  /** The visible text paired with the native checkbox. */
  readonly label: string;

  /** Controls the checkbox and label scale. @default "md" */
  readonly size?: 'sm' | 'md';
}

const BOX_SIZE_CLASSES: Readonly<Record<NonNullable<KryptonCheckboxProps['size']>, string>> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
};

/**
 * Renders an accessible native checkbox with tokenized checked-state feedback.
 *
 * @param {KryptonCheckboxProps} props - Native checked behavior plus visible label and size.
 * @returns {React.JSX.Element} A labelled checkbox with a semantic cyan indicator.
 * @example
 * <KryptonCheckbox label="Select alert" />
 * // => renders a medium labelled checkbox
 */
export const KryptonCheckbox = forwardRef<HTMLInputElement, KryptonCheckboxProps>(
  function KryptonCheckbox({ label, size = 'md', ...checkboxProps }, ref): React.JSX.Element {
    return (
      <label className="inline-flex cursor-pointer items-center gap-krypton-space-2 text-sm text-slate-300">
        <span className={`relative inline-flex shrink-0 ${BOX_SIZE_CLASSES[size]}`}>
          <input
            className="peer h-full w-full appearance-none rounded-krypton-radius-control border border-krypton-border-muted bg-krypton-bg-surface checked:border-krypton-accent-cyan checked:bg-krypton-accent-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krypton-accent-cyan/40 disabled:cursor-not-allowed disabled:opacity-50"
            ref={ref}
            type="checkbox"
            {...checkboxProps}
          />
          <Check
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full scale-75 text-slate-950 opacity-0 peer-checked:opacity-100"
            strokeWidth={3}
          />
        </span>
        <span>{label}</span>
      </label>
    );
  }
);

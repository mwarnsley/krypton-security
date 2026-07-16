import { forwardRef, type InputHTMLAttributes } from 'react';

export interface KryptonInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'size'
> {
  /** Controls the fixed form-control height. @default "md" */
  readonly size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASSES: Readonly<Record<NonNullable<KryptonInputProps['size']>, string>> = {
  sm: 'h-8 px-krypton-space-3 text-xs',
  md: 'h-10 px-krypton-space-3 text-sm',
  lg: 'h-11 px-krypton-space-4 text-sm',
};

/**
 * Renders a token-driven native text input with a consistent active focus state.
 *
 * @param {KryptonInputProps} props - Native input behavior and fixed size selection.
 * @returns {React.JSX.Element} A forwarded native input control.
 * @example
 * <KryptonInput aria-label="Filter alerts" placeholder="Search" />
 * // => renders the standard medium input
 */
export const KryptonInput = forwardRef<HTMLInputElement, KryptonInputProps>(function KryptonInput(
  { size = 'md', type = 'text', ...inputProps },
  ref
): React.JSX.Element {
  return (
    <input
      className={`w-full rounded-krypton-radius-control border border-krypton-border-muted bg-krypton-bg-surface text-slate-100 placeholder:text-slate-500 focus-visible:border-krypton-accent-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krypton-accent-cyan/30 disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASSES[size]}`}
      ref={ref}
      type={type}
      {...inputProps}
    />
  );
});

export interface KryptonLoadingSpinnerProps {
  /** The assistive status text announced while loading. @default "Loading" */
  readonly label?: string;

  /** Controls the responsive spinner footprint. @default "md" */
  readonly size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASSES: Readonly<Record<NonNullable<KryptonLoadingSpinnerProps['size']>, string>> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2 sm:h-7 sm:w-7',
  lg: 'h-9 w-9 border-4 sm:h-10 sm:w-10',
};

/**
 * Renders a lightweight CSS-only looping API activity indicator.
 *
 * @param {KryptonLoadingSpinnerProps} props - Accessible label and responsive size.
 * @returns {React.JSX.Element} A polite status region containing an animated ring.
 * @example
 * <KryptonLoadingSpinner label="Loading telemetry" />
 * // => renders a medium cyan spinner
 */
export function KryptonLoadingSpinner(props: KryptonLoadingSpinnerProps): React.JSX.Element {
  const { label = 'Loading', size = 'md' } = props;

  return (
    <span aria-label={label} className="inline-flex items-center justify-center" role="status">
      <span
        aria-hidden="true"
        className={`animate-spin rounded-krypton-radius-full border-krypton-spinner-track border-t-krypton-spinner-foreground motion-reduce:animate-pulse ${SIZE_CLASSES[size]}`}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

import type { HTMLAttributes } from 'react';

export type KryptonTypographyVariant = 'h1' | 'h2' | 'body' | 'mono-code';

export interface KryptonTypographyProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'className' | 'style'
> {
  /** Selects both the semantic element and its fixed typographic scale. @default "body" */
  readonly variant?: KryptonTypographyVariant;
}

const ELEMENTS: Readonly<Record<KryptonTypographyVariant, 'h1' | 'h2' | 'p' | 'code'>> = {
  h1: 'h1',
  h2: 'h2',
  body: 'p',
  'mono-code': 'code',
};

const VARIANT_CLASSES: Readonly<Record<KryptonTypographyVariant, string>> = {
  h1: 'text-3xl font-bold tracking-tight text-krypton-fg-primary sm:text-4xl',
  h2: 'text-xl font-bold tracking-tight text-krypton-fg-primary sm:text-2xl',
  body: 'text-sm leading-6 text-krypton-fg-secondary',
  'mono-code': 'font-mono text-xs leading-5 tracking-krypton-mono text-krypton-accent-cyan',
};

/**
 * Renders dashboard text through one semantic scale contract.
 *
 * @param {KryptonTypographyProps} props - Semantic variant and native element attributes.
 * @returns {React.JSX.Element} The element assigned to the selected typography variant.
 * @example
 * <KryptonTypography variant="h1">Security events</KryptonTypography>
 * // => renders the dashboard h1 scale
 */
export function KryptonTypography(props: KryptonTypographyProps): React.JSX.Element {
  const { variant = 'body', ...typographyProps } = props;
  const Component = ELEMENTS[variant];

  return <Component className={VARIANT_CLASSES[variant]} {...typographyProps} />;
}

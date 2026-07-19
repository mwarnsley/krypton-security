import { expectTypeOf, describe, it } from 'vitest';

import type { KryptonButtonProps } from './KryptonButton';
import type { KryptonCheckboxProps } from './KryptonCheckbox';
import type { KryptonIconButtonProps } from './KryptonIconButton';
import type { KryptonInputProps } from './KryptonInput';
import type { KryptonLoadingSpinnerProps } from './KryptonLoadingSpinner';
import type { KryptonSelectProps } from './KryptonSelect';
import type { KryptonToggleProps } from './KryptonToggle';
import type { KryptonTooltipProps } from './KryptonTooltip';
import type { KryptonTypographyProps } from './KryptonTypography';

type HasRawStyleOverride<Props> = 'className' extends keyof Props
  ? true
  : 'style' extends keyof Props
    ? true
    : false;

describe('Krypton primitive structural bounds', () => {
  it('bounds KryptonButton styling', () => {
    expectTypeOf<HasRawStyleOverride<KryptonButtonProps>>().toEqualTypeOf<false>();
  });

  it('bounds KryptonCheckbox styling', () => {
    expectTypeOf<HasRawStyleOverride<KryptonCheckboxProps>>().toEqualTypeOf<false>();
  });

  it('bounds KryptonIconButton styling', () => {
    expectTypeOf<HasRawStyleOverride<KryptonIconButtonProps>>().toEqualTypeOf<false>();
  });

  it('bounds KryptonInput styling', () => {
    expectTypeOf<HasRawStyleOverride<KryptonInputProps>>().toEqualTypeOf<false>();
  });

  it('bounds KryptonLoadingSpinner styling', () => {
    expectTypeOf<HasRawStyleOverride<KryptonLoadingSpinnerProps>>().toEqualTypeOf<false>();
  });

  it('bounds KryptonSelect styling', () => {
    expectTypeOf<HasRawStyleOverride<KryptonSelectProps>>().toEqualTypeOf<false>();
  });

  it('bounds KryptonToggle styling', () => {
    expectTypeOf<HasRawStyleOverride<KryptonToggleProps>>().toEqualTypeOf<false>();
  });

  it('bounds KryptonTooltip styling', () => {
    expectTypeOf<HasRawStyleOverride<KryptonTooltipProps>>().toEqualTypeOf<false>();
  });

  it('bounds KryptonTypography styling', () => {
    expectTypeOf<HasRawStyleOverride<KryptonTypographyProps>>().toEqualTypeOf<false>();
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Audit actual CSS token values. Rendered browser audits are still required for
// layout, transparency, focus visibility and screen-reader behavior.
const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
type Color = readonly number[];
function luminance(color: Color): number {
  const linear = color.map((byte) => {
    const value = byte / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}
function contrast(a: Color, b: Color): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}
function blend(foreground: Color, background: Color, opacity: number): Color {
  return foreground.map((value, index) => value * opacity + background[index]! * (1 - opacity));
}
const textTokens = [
  'fg-primary',
  'fg-secondary',
  'fg-muted',
  'table-header',
  'accent-cyan',
  'accent-blue',
  'accent-violet',
  'alert-rose',
  'warning-amber',
  'warning-foreground',
  'danger-foreground',
  'success',
  'severity-medium',
  'severity-low',
];
for (const [theme, selector] of [
  ['dark', ':root'],
  ['light', ":root[data-theme='light']"],
] as const) {
  const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0]!;
  const tokens = new Map(
    [...block.matchAll(/--krypton-([\w-]+): (\d+) (\d+) (\d+);/g)].map((match) => [
      match[1]!,
      match.slice(2).map(Number),
    ])
  );
  const color = (name: string): Color => {
    const result = tokens.get(name);
    if (!result) throw new Error(`Missing ${theme} color token: ${name}`);
    return result;
  };
  describe(`${theme} semantic palette`, () => {
    it.each(textTokens)('%s text meets AA on main and card surfaces', (token) => {
      for (const background of ['bg-main', 'bg-surface']) {
        expect(contrast(color(token), color(background))).toBeGreaterThanOrEqual(4.5);
      }
    });
    it('keeps drawer body text above 5.5:1 on its surfaces', () => {
      for (const background of ['bg-main', 'bg-surface', 'control-hover']) {
        expect(contrast(color('fg-body'), color(background))).toBeGreaterThanOrEqual(5.5);
      }
    });
    it.each(['control-border', 'focus-ring'])('%s meets 3:1 on control backgrounds', (token) => {
      for (const background of ['bg-main', 'bg-surface', 'control-active', 'control-hover']) {
        expect(contrast(color(token), color(background))).toBeGreaterThanOrEqual(3);
      }
    });
    it('keeps selected-tab copy readable on the active surface', () => {
      expect(contrast(color('fg-primary'), color('control-active'))).toBeGreaterThanOrEqual(4.5);
    });
    it.each([
      'accent-cyan',
      'alert-rose',
      'warning-amber',
      'success',
      'severity-medium',
      'severity-low',
    ])('%s remains readable on its tinted badge', (token) => {
      expect(
        contrast(color(token), blend(color(token), color('bg-surface'), 0.1))
      ).toBeGreaterThanOrEqual(4.5);
    });
    it.each(['accent-cyan', 'alert-rose'])(
      '%s filled button copy remains readable on hover',
      (token) => {
        expect(
          contrast(color('bg-main'), blend(color(token), color('bg-surface'), 0.9))
        ).toBeGreaterThanOrEqual(4.5);
      }
    );
    it('keeps a hovered link readable on the card surface', () => {
      expect(
        contrast(blend(color('accent-cyan'), color('bg-surface'), 0.9), color('bg-surface'))
      ).toBeGreaterThanOrEqual(4.5);
    });
  });
}

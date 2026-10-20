import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { expect, it } from 'vitest';

import { countAlertSeverities, formatAlertCount } from './alertSeverity';

it('counts every loaded severity, including informational events', () => {
  expect(
    countAlertSeverities([
      { severity: 'critical' },
      { severity: 'high' },
      { severity: 'high' },
      { severity: 'medium' },
      { severity: 'low' },
      { severity: 'info' },
    ])
  ).toEqual({ critical: 1, high: 2, medium: 1, low: 1, info: 1 });
  expect(countAlertSeverities([])).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
});

it('preserves exact counts while compacting five-digit values', () => {
  expect(formatAlertCount(9999)).toEqual({ display: '9,999', exact: '9,999' });
  expect(formatAlertCount(12000)).toEqual({ display: '12K', exact: '12,000' });
  expect(formatAlertCount(-1)).toEqual({ display: 'Unavailable', exact: 'Unavailable' });
});

it('generates every severity border and text color from the shared palette', async () => {
  const result = await postcss([tailwindcss('src/dashboard/tailwind.config.js')]).process(
    '@tailwind utilities;',
    {
      from: undefined,
    }
  );
  for (const token of [
    'alert-rose',
    'warning-amber',
    'severity-medium',
    'severity-low',
    'accent-cyan',
  ]) {
    expect(result.css).toContain(`.border-krypton-${token}\\/40`);
    expect(result.css).toContain(`.text-krypton-${token}`);
  }
}, 30000);

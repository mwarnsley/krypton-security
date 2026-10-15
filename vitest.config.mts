import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Shared CI machines need more scheduling headroom; I/O-heavy suites set their own budgets.
    testTimeout: process.env.CI ? 15_000 : 5_000,
    coverage: {
      provider: 'v8',
      thresholds: {
        branches: 50,
        functions: 60,
        lines: 55,
        statements: 55,
      },
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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

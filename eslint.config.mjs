import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  prettier,
  {
    settings: {
      next: {
        rootDir: 'src/dashboard/',
      },
    },
  },
  {
    files: ['**/*.cjs', '**tests__/**/*.ts', '**tests**/**/*.ts', 'tests_simulation/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/dashboard/components/features/AlertTable/AlertTable.tsx'],
    rules: {
      // TanStack Table intentionally returns stateful functions that React Compiler cannot memoize.
      'react-hooks/incompatible-library': 'off',
    },
  },
  globalIgnores([
    '**/.next/**',
    '**/coverage/**',
    '**/dist/**',
    '**/node_modules/**',
    '**/out/**',
    '**/target/**',
    'sandbox_workspace/**',
  ]),
]);

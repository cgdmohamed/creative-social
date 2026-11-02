import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import { fileURLToPath } from 'node:url';

// Next 16 exports native flat configs. Passing them through FlatCompat causes
// circular-config serialization errors before ESLint can analyze any file.
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/out/**',
      '**/build/**',
      '**/*.tsbuildinfo',
      '**/next-env.d.ts',
      'coverage/**',
      'reports/**',
      'libraries/plugins/src/plugins.ts',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    settings: {
      next: {
        rootDir: fileURLToPath(new URL('./apps/frontend/', import.meta.url)),
      },
    },
    rules: {
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'react/display-name': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/prefer-as-const': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
    },
  },
];

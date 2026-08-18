// Framework-agnostic ESLint base for the whole monorepo.
//
// Flat config does not cascade from a workspace root into its packages, so each
// package keeps its own eslint.config.mjs that imports this file (directly, or
// via eslint.backend.mjs / eslint.frontend.mjs).
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export const ignores = ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/*.tsbuildinfo']

export default tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Prefix-with-underscore is the escape hatch for deliberately unused args.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
)

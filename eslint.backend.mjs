// Backend (NestJS) ESLint flavour: base + rules that decorator-driven,
// dependency-injected Nest code needs relaxed.
import globals from 'globals'
import tseslint from 'typescript-eslint'
import base from './eslint.base.mjs'

export default tseslint.config(...base, {
  languageOptions: {
    globals: { ...globals.node },
  },
  rules: {
    // Nest's DI container instantiates providers by decorator metadata, so
    // constructor parameter properties and empty interfaces are idiomatic here.
    '@typescript-eslint/no-empty-interface': 'off',
    '@typescript-eslint/no-empty-object-type': 'off',
    // The vendored libs are deliberately schema-agnostic and lean on `any` at
    // their generic boundaries (see prisma-db-client's own CLAUDE.md); warn so
    // it stays visible without blocking the build.
    '@typescript-eslint/no-explicit-any': 'warn',
  },
})

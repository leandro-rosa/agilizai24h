// Frontend ESLint flavour: base + browser globals + React hooks rules.
//
// Next-specific config is layered on top by the consuming app (see
// frontend/apps/admin/eslint.config.mjs), because eslint-config-next is a
// dependency of that app rather than of the workspace root.
import globals from 'globals'
import tseslint from 'typescript-eslint'
import base from './eslint.base.mjs'

export default tseslint.config(...base, {
  languageOptions: {
    globals: { ...globals.browser },
  },
  rules: {
    // Components are typed via props/JSX rather than explicit return types, and
    // third-party UI libs surface plenty of `any` at their boundaries.
    '@typescript-eslint/no-explicit-any': 'warn',
  },
})

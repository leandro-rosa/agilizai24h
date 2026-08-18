import tseslint from 'typescript-eslint'
import backend from '../../../../eslint.backend.mjs'

// These libs were vendored in from another repository and carry pre-existing
// dead code (unused imports, locals, and function parameters). Demoted to a
// warning HERE ONLY — the shared backend flavour keeps it an error, so every
// service written under backend/apps/ is still held to it. Cleaning the libs up
// is its own change, not a side effect of the workspace bootstrap.
export default tseslint.config(...backend, {
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
})

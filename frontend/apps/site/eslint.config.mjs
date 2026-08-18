import { defineConfig, globalIgnores } from 'eslint/config'
import frontend from '../../../eslint.frontend.mjs'

export default defineConfig([
  ...frontend,
  globalIgnores([
    'dist/**',
    // Vendored shadcn/ui components and the Figma Make export they came with —
    // regenerated rather than hand-maintained, so they are not linted. See this
    // app's CLAUDE.md "Gaps conhecidos".
    'src/app/components/ui/**',
    'src/app/components/figma/**',
    'src/imports/**',
  ]),
])

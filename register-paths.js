/**
 * Runtime resolver for the `@app/*` path alias.
 *
 * `backend/tsconfig.json` maps `@app/*` to `common/nest-libs/*/src` for the
 * TypeScript compiler, but Node knows nothing about tsconfig `paths` when it
 * `require()`s the compiled JavaScript in `dist/`. Without this shim a service
 * crashes on its first `@app/*` import as soon as it actually runs.
 *
 * Load it before the app entrypoint:
 *
 *   node -r ./register-paths.js dist/backend/apps/<service>/main.js
 *
 * `baseUrl` defaults to the compiled backend root next to this file, which is
 * where `tsc` places `common/nest-libs/*` when a service is built from
 * `backend/tsconfig.json`. Override it with APP_PATHS_BASE_URL when the image
 * lays the build out somewhere else.
 */
const path = require('path')
const { register } = require('tsconfig-paths')

const baseUrl = process.env.APP_PATHS_BASE_URL
  ? path.resolve(process.env.APP_PATHS_BASE_URL)
  : path.resolve(__dirname, 'dist', 'backend')

register({
  baseUrl,
  paths: {
    '@app/*': ['common/nest-libs/*/src'],
  },
})

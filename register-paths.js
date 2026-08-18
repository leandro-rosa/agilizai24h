// Runtime resolver for the `@app` path aliases.
//
// `backend/tsconfig.json` maps them onto the nest-libs sources for the
// TypeScript compiler, but Node knows nothing about tsconfig `paths` when it
// requires the compiled JavaScript in `dist`. Without this shim a service
// crashes on its first `@app` import as soon as it actually runs.
//
// Load it before the app entrypoint:
//
//   node -r ../../../register-paths.js dist/apps/<service>/src/main.js
//
// `baseUrl` defaults to `<cwd>/dist`, so a service started from its own folder
// resolves the libs its build emitted alongside it. Each service compiles to an
// app-local `dist` on purpose: a repo-root dist can only reach root
// node_modules, which under pnpm's isolated layout does not hold the app's
// runtime dependencies. Override with APP_PATHS_BASE_URL if an image lays the
// build out somewhere else.
//
// Line comments, not a block comment, deliberately: the alias globs below
// contain a star followed by a slash, which silently terminates a block
// comment early and leaves the rest of the file parsed as code. That bug
// shipped once and only surfaced when the first service loaded this file.
const path = require('path')
const { register } = require('tsconfig-paths')

const baseUrl = process.env.APP_PATHS_BASE_URL
  ? path.resolve(process.env.APP_PATHS_BASE_URL)
  : path.resolve(process.cwd(), 'dist')

register({
  baseUrl,
  // Two patterns per lib, mirroring backend/tsconfig.json: a lone '@app' star
  // wildcard swallows the subpath and appends src after it.
  paths: {
    '@app/aws': ['common/nest-libs/aws/src'],
    '@app/aws/*': ['common/nest-libs/aws/src/*'],
    '@app/elasticsearch': ['common/nest-libs/elasticsearch/src'],
    '@app/elasticsearch/*': ['common/nest-libs/elasticsearch/src/*'],
    '@app/health': ['common/nest-libs/health/src'],
    '@app/health/*': ['common/nest-libs/health/src/*'],
    '@app/hold-it': ['common/nest-libs/hold-it/src'],
    '@app/hold-it/*': ['common/nest-libs/hold-it/src/*'],
    '@app/http-client': ['common/nest-libs/http-client/src'],
    '@app/http-client/*': ['common/nest-libs/http-client/src/*'],
    '@app/iam-contracts': ['common/nest-libs/iam-contracts/src'],
    '@app/iam-contracts/*': ['common/nest-libs/iam-contracts/src/*'],
    '@app/ingestion-contracts': ['common/nest-libs/ingestion-contracts/src'],
    '@app/ingestion-contracts/*': ['common/nest-libs/ingestion-contracts/src/*'],
    '@app/products-contracts': ['common/nest-libs/products-contracts/src'],
    '@app/products-contracts/*': ['common/nest-libs/products-contracts/src/*'],
    '@app/prisma-db-client': ['common/nest-libs/prisma-db-client/src'],
    '@app/prisma-db-client/*': ['common/nest-libs/prisma-db-client/src/*'],
    '@app/quote-search-match': ['common/nest-libs/quote-search-match/src'],
    '@app/quote-search-match/*': ['common/nest-libs/quote-search-match/src/*'],
    '@app/sheeter': ['common/nest-libs/sheeter/src'],
    '@app/sheeter/*': ['common/nest-libs/sheeter/src/*'],
  },
})

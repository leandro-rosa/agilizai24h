## Why

`backend/apps/` is empty and this monorepo has no workspace tooling at all — no root
`package.json`, no `pnpm-workspace.yaml`, no `turbo.json`, no `backend/tsconfig.json`,
no CI. The eight libs in `backend/common/nest-libs/` are consumed through an `@app/*`
path alias that nothing currently defines, and each lib's `tsconfig.lib.json` already
extends a `backend/common/tsconfig.json` that does not exist. There is no such thing as
a real microservice under `backend/apps/` until that foundation exists.

Every subsequent proposal in the roadmap (`add-iam-service`, `add-stores-service`, …)
depends on this. Landing it once, deliberately, is the alternative to each service
proposal inventing its own workspace layout as a side effect.

## What Changes

- **pnpm + Turborepo workspace** — root `package.json`, `pnpm-workspace.yaml` covering
  `backend/apps/*`, `backend/common/nest-libs/*`, `frontend/apps/*`, `frontend/common/*`,
  and `turbo.json` with `build`/`lint`/`typecheck`/`test` tasks.
- **TypeScript bases** — `backend/tsconfig.json` (defining the `@app/*` → `common/nest-libs/*/src`
  mapping) and `backend/common/tsconfig.json`, matching what the existing libs already
  assume. Plus `register-paths.js` for runtime `@app/*` resolution in compiled `dist/`.
- **A `package.json` per `nest-lib`** — all eight libs currently have only `src/` and
  `tsconfig.lib.json`; pnpm requires a manifest per workspace member. Dependencies are
  derived from each lib's actual imports, not guessed.
- **BREAKING (developer workflow): npm → pnpm for both frontend apps.** `frontend/apps/admin`
  and `frontend/apps/site` currently install via their own `package-lock.json`. Those are
  removed in favour of a single root `pnpm-lock.yaml`. `frontend/apps/site` additionally
  needs `react`/`react-dom` promoted from optional `peerDependencies` to real
  `dependencies` — it resolves them today only by accident of npm's flat hoisting, which
  pnpm's isolated `node_modules` does not reproduce.
- **Shared lint/format config** — root ESLint flat configs in base/backend/frontend
  flavours, each package importing the matching one; the existing root `.prettierrc` is
  reused.
- **Shared dev infrastructure** — a new `docker/composes/docker-compose.infra.yaml` with
  Redis (for `@app/hold-it`) and MinIO (S3-compatible, for `@app/aws`), on the external
  `agiliz_network`, registered in `cli/agiliz-cli` as an `infra` project that comes up
  first and goes down last.
- **`.env.example` template** with `WITH_KAFKA_BROKERS=false` baked in, so no future
  service can trip the `HoldItModule` DI-crash gotcha.
- **CI skeleton** — GitHub Actions running lint/typecheck/test through Turborepo with
  affected-only filtering.
- **Node version floor** — pinned to Node 20+ LTS via `.nvmrc` and `engines`; nothing in
  the repo documents a minimum today.

Explicitly **not** in scope: no microservice is created, no business logic, no database,
no Postgres container, no contracts package. Those belong to the proposals that need them.

## Capabilities

### New Capabilities

None. This change introduces no system behaviour — it is workspace tooling, shared
configuration, dev infrastructure, and CI. Per the schema's own guidance, it sets
`skip_specs: true` in `.openspec.yaml` rather than inventing a requirement to satisfy
validation.

### Modified Capabilities

None. `openspec/specs/` is empty; no existing requirement changes.

## Impact

- **New at repo root**: `package.json`, `pnpm-workspace.yaml`, `turbo.json`,
  `register-paths.js`, `.nvmrc`, `.env.example`, `eslint.base.mjs`,
  `eslint.backend.mjs`, `eslint.frontend.mjs`, `.github/workflows/ci.yml`.
- **New under `backend/`**: `tsconfig.json`, `common/tsconfig.json`, and a
  `package.json` in each of the eight `nest-libs`.
- **Modified**: `frontend/apps/admin` and `frontend/apps/site` (`package.json`,
  lockfile removal, ESLint config re-pointed to the shared flavour);
  `cli/agiliz-cli` and `cli/CLAUDE.md` (new `infra` project); root `CLAUDE.md` and
  `backend/CLAUDE.md` (tooling is no longer "not configured yet"; `docker/composes/`
  is no longer described as empty).
- **New under `docker/composes/`**: `docker-compose.infra.yaml`.
- **Developer environment**: contributors need Node 20+ and pnpm; existing
  `node_modules/` and `package-lock.json` in both frontend apps must be discarded and
  reinstalled.
- **Untouched but flagged**: `docker/composes/docker-compose.redis.yaml`,
  `docker-compose.observability.yaml`, and `docker-compose.cli.yaml` are leftovers from
  an unrelated prior project ("smartparts", referencing `backend/apps/{quote,search,bull-board}`
  which do not exist here) using network names this repo does not use. They are
  deliberately not reused or edited here — see `design.md`.

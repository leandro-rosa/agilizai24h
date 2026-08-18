## 1. Workspace skeleton

- [x] 1.1 Add root `package.json`: private, name `agilizai24h`, `packageManager` pinned to a specific pnpm version, `engines.node` `>=24`, and root scripts delegating to `turbo`
- [x] 1.2 Add root `.nvmrc` pinning Node 24 (matches `node:24-alpine` in both existing Dockerfiles — see design D12)
- [x] 1.3 Add `pnpm-workspace.yaml` with `backend/apps/*`, `backend/common/nest-libs/*`, `frontend/apps/*`, `frontend/common/*`
- [x] 1.4 Add `turbo.json` with `build` (`dependsOn: ["^build"]`, outputs `dist/**` and `.next/**`), `typecheck` (`dependsOn: ["^build"]`), `lint`, and `test` (`dependsOn: ["^build"]`) tasks
- [x] 1.5 Add root `.gitignore` entries for `node_modules/`, `dist/`, `.turbo/`, and confirm `pnpm-lock.yaml` is committed (not ignored)

## 2. TypeScript bases and `@app/*` resolution

- [x] 2.1 Add `backend/tsconfig.json` with the `@app/*` → `common/nest-libs/*/src` path mapping, exactly as specified in `.claude/skills/nestjs-microservice-architecture/references/repo-gaps.md`
- [x] 2.2 Add `backend/common/tsconfig.json` extending `../tsconfig.json` with `composite` + `declaration`, matching what every existing `tsconfig.lib.json` already assumes
- [x] 2.3 Add root `register-paths.js` using `tsconfig-paths/register` for runtime `@app/*` resolution from compiled `dist/`, and add `tsconfig-paths` as a root dependency
- [x] 2.4 Verify each of the eight `tsconfig.lib.json` files resolves against the new bases without edits; if any needs a change, note it rather than silently adjusting the lib

## 3. Library manifests

- [x] 3.1 Read each lib's `src/` imports to derive its real external dependencies — do not guess (see design "Risks": a wrong manifest stays invisible until a service imports that path)
- [x] 3.2 Add a `package.json` to each of the eight `nest-libs`, named `@app/<lib>` to match the tsconfig path alias, with `main`/`types` pointing at the lib build output and a `typecheck` script
- [x] 3.3 Declare NestJS and other framework packages as `peerDependencies` where the lib expects the consuming app to own the version, with matching `devDependencies` so the lib typechecks standalone
- [x] 3.4 Run `pnpm install` at the root and confirm the workspace graph links all eight libs
- [x] 3.5 Run `pnpm turbo run typecheck` and confirm all eight libs typecheck with `@app/*` resolving

## 4. Frontend migration to pnpm

- [x] 4.1 Rename packages: `frontend/apps/admin` → `@agiliz/admin`, `frontend/apps/site` → `@agiliz/site` (currently the meaningless Figma Make export name `@figma/my-make-file`)
- [x] 4.2 Promote `react` and `react-dom` in `frontend/apps/site/package.json` from optional `peerDependencies` to real `dependencies`, pinned to the versions it resolves today (see design D3 — it works now only via npm hoisting)
- [x] 4.3 Remove the vestigial `pnpm.overrides` block from `frontend/apps/site/package.json` or promote it to the root workspace, whichever the resolved Vite version requires
- [x] 4.4 Delete `frontend/apps/admin/package-lock.json` and `frontend/apps/site/package-lock.json`; reinstall from the root and commit a single `pnpm-lock.yaml`
- [x] 4.5 Confirm outside Docker that both apps still work: `admin` dev + `next build`, `site` dev + `vite build`. Fix any further phantom dependencies isolated linking exposes
- [x] 4.6 Add a `typecheck` script to `admin` so it participates in the Turborepo `typecheck` task. NOTE: `site` is excluded — it has 61 TS/TSX files but no `tsconfig.json` and no `typescript` dependency (Vite transpiles via esbuild without typechecking). Adding TypeScript checking to that Figma-export codebase is its own change, not workspace plumbing

## 5. Docker build under a workspace

- [x] 5.1 Rewrite `frontend/apps/admin/Dockerfile` for a repo-root build context: install with pnpm scoped to `@agiliz/admin`, using `pnpm deploy --filter --prod` or `turbo prune --docker` so the runtime image does not carry the whole monorepo
- [x] 5.2 Preserve `ENV HOSTNAME=0.0.0.0` and the `base → dev → build → prod` stage structure in `admin`'s Dockerfile — these are load-bearing (see design D2)
- [x] 5.3 Rewrite `frontend/apps/site/Dockerfile` the same way, keeping the nginx `prod` stage unchanged
- [x] 5.4 Update both `docker-compose.yml` files: `context: ../../..` with an explicit `dockerfile:` path, keeping `agiliz_network` external, the `admin-prod` healthcheck on `http://127.0.0.1:3000`, and the dev bind-mount/anonymous-volume setup working
- [x] 5.5 Rebuild and run all four targets (`admin-dev`, `admin-prod`, `site-dev`, `site-prod`); confirm `admin-prod` reaches `healthy` and both dev servers still hot-reload

## 6. Shared infrastructure

- [x] 6.1 Add `docker/composes/docker-compose.infra.yaml` with Redis (named volume, `redis-cli ping` healthcheck) and MinIO (named volume, console + API ports, healthcheck), both on `agiliz_network` as `external: true` with an explicit `name:` so Compose does not project-prefix it
- [x] 6.2 Do not modify or reuse the three stale `smartparts` compose files in that folder (see design D7)
- [x] 6.3 Register `infra` in `cli/agiliz-cli`: add to `VALID_PROJECTS`, `PROJECT_DIRECTORIES` (`docker/composes`), `PROJECT_FILES` (`docker-compose.infra.yaml`), prepend to `UP_ORDER`, append to `DOWN_ORDER`, and deliberately omit it from `PROJECT_DEV_SERVICE`/`PROJECT_PROD_SERVICE`
- [x] 6.4 Update the `PROJECTS` block in `agiliz-cli`'s `--help` output and the bash completion candidates
- [x] 6.5 Exercise `agiliz-cli up -i infra`, `logs -i infra`, and `down -i infra`, then a full `agiliz-cli up`/`down`, confirming infra starts first and stops last (design "Risks" — the empty dev/prod key behaviour is inferred from reading the script, so verify it)

## 7. Environment template

- [x] 7.1 Add a root `.env.example` documenting `DATABASE_URL` (per-service pattern), `REDIS_QUEUE_HOST`/`REDIS_QUEUE_PORT`, and the MinIO/S3 variables `@app/aws` reads — names verified against each lib's actual config, not invented
- [x] 7.2 Include `WITH_KAFKA_BROKERS=false` with a comment explaining that leaving it unset crashes NestJS DI at startup via `HoldItKafkaBroker` → `HoldItElasticsearchService`
- [x] 7.3 Confirm `.env` (without `.example`) is gitignored

## 8. Lint and format

- [x] 8.1 Add root `eslint.base.mjs` (TypeScript + import hygiene, framework-agnostic)
- [x] 8.2 Add root `eslint.backend.mjs` (base + NestJS-friendly rules: decorators, parameter properties)
- [x] 8.3 Add root `eslint.frontend.mjs` (base + `eslint-config-next` flat config)
- [x] 8.4 Re-point `frontend/apps/admin/eslint.config.mjs` at the shared frontend flavour, preserving its `globalIgnores` for shadcn-vendored paths (`src/components/ui/**`, `src/hooks/use-mobile.ts`)
- [x] 8.5 Add an `eslint.config.mjs` and a `lint` script to `frontend/apps/site` (it has neither today); fix or explicitly ignore the resulting violations rather than leaving CI red
- [x] 8.6 Add a `lint` script to each of the eight libs importing the backend flavour. NOTE: the lib configs also demote `no-unused-vars` to a warning for vendored dead code (unused imports/locals/params); the shared backend flavour keeps it an error so future services under `backend/apps/` are still held to it
- [x] 8.7 Keep the existing root `.prettierrc` unchanged and confirm `pnpm turbo run lint` passes repo-wide

## 9. CI

- [x] 9.1 Add `.github/workflows/ci.yml` triggering on pull requests and pushes to `main`
- [x] 9.2 Use `actions/checkout` with `fetch-depth: 0` so Turborepo's affected filter can compute a merge-base (see design D13 — without it CI silently tests nothing)
- [x] 9.3 Set up pnpm with dependency caching, install with `--frozen-lockfile`, and run `turbo run lint typecheck test --filter=...[origin/main]`
- [x] 9.4 Confirm the affected filter actually selects packages when one is touched (not a silent zero-package run) — verified locally via `turbo ... --filter='...[HEAD]' --dry=json` (11 packages, 30 tasks). The workflow itself cannot run until this branch is pushed

## 10. Documentation

- [x] 10.1 Update root `CLAUDE.md`: workspace tooling is now configured, and `docker/composes/` is not empty — it holds the new infra file plus three stale files from an unrelated project
- [x] 10.2 Update `backend/CLAUDE.md`: the `@app/*` alias, tsconfig bases, and per-lib manifests now exist
- [x] 10.3 Update `cli/CLAUDE.md`: document the `infra` project in the registry table and the ordering rule that it comes up first and goes down last
- [x] 10.4 Update `frontend/CLAUDE.md` and both frontend apps' `CLAUDE.md`: pnpm workspace, new package names, and the root-context Docker build
- [x] 10.5 Add a short "getting started" section to the root `CLAUDE.md` covering Node 24 + pnpm + `agiliz-cli up`

## 11. Verification

- [x] 11.1 From a clean clone: `pnpm install` then `pnpm turbo run lint typecheck build` passes end to end
- [x] 11.2 `agiliz-cli up` brings up infra plus both frontends; `agiliz-cli down` tears them down in reverse
- [x] 11.3 Confirm Redis accepts a connection and MinIO's console is reachable, so the first backend service has working infrastructure to target
- [x] 11.4 `openspec validate add-monorepo-foundation --strict` passes

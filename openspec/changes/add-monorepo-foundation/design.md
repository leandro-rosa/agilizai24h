## Context

See `proposal.md` — Why. Constraints that shape the approach, all verified against the
repo rather than assumed:

- **The libs already assume a layout that does not exist.** Every
  `backend/common/nest-libs/*/tsconfig.lib.json` extends `../../tsconfig.json`
  (i.e. `backend/common/tsconfig.json`), and every lib is consumed as `@app/<lib>`. Neither
  the base tsconfigs nor the path mapping exist. The
  `.claude/skills/nestjs-microservice-architecture` skill's `references/repo-gaps.md`
  specifies the exact intended contents; this change lands them verbatim so the skill and
  the repo agree.
- **The eight libs have no `package.json`** — only `CLAUDE.md`, `src/`, and
  `tsconfig.lib.json`. pnpm requires a manifest per workspace member.
- **Both frontend apps are on npm**, each with its own `package-lock.json`, and both
  Dockerfiles do `COPY package*.json ./ && npm ci` with the **app folder as the build
  context**. A workspace lockfile at the repo root is incompatible with that context.
- **`frontend/apps/site` is a Figma Make export**: package name `@figma/my-make-file`, no
  lint script, no ESLint config, and `react`/`react-dom` declared only as *optional*
  `peerDependencies` — it resolves them today purely through npm's flat hoisting.
- **`docker/composes/` is not empty** (the root `CLAUDE.md` says it is): it holds three
  compose files from an unrelated prior project — `smartparts`, referencing
  `backend/apps/{quote,search,bull-board}` and networks `redis_network` /
  `observability_network`. This repo's real convention, live in `cli/agiliz-cli`
  (`SHARED_NETWORK_NAME`) and both frontend compose files, is the single external network
  `agiliz_network`.
- **`cli/agiliz-cli` is a single Bash script** with a static registry at lines 12–30. A
  project omitted from `PROJECT_DEV_SERVICE`/`PROJECT_PROD_SERVICE` resolves to an empty
  service name (`${PROJECT_PROD_SERVICE[$p]:-}`) and is therefore acted on in full in both
  modes — the correct shape for infrastructure with no dev/prod split.

## Goals / Non-Goals

**Goals:**

- A `pnpm install` at the repo root that wires every package, including `@app/*`
  resolution at compile time and at runtime.
- A foundation the `nestjs-microservice-architecture` skill can scaffold onto without
  bootstrapping anything itself.
- Shared dev infrastructure (Redis, object storage) that any future service joins rather
  than provisions.
- Leave both frontend apps working — building, running, and serving under `agiliz-cli`
  exactly as they do today.

**Non-Goals:**

- No microservice, no database, no Prisma schema, no queue, no contracts package. Those
  arrive with the proposals that need them.
- No observability stack. `docker-compose.observability.yaml` is out of scope here.
- No cleanup of the stale `smartparts` compose files (see Decisions).
- No change to either frontend app's runtime behaviour, UI, or dependency versions beyond
  what the package-manager migration strictly requires.

## Decisions

### D1 — The pnpm workspace covers frontend apps too, not just backend

`repo-gaps.md` lists only `backend/apps/*` and `backend/common/nest-libs/*`. This change
extends the globs to `frontend/apps/*` and `frontend/common/*`.

*Why:* `frontend/common/` exists precisely to hold RTK slices and components shared
between `site` and `admin`. A shared frontend package is unusable if the apps that consume
it are installed by a different package manager from a different lockfile. Deferring this
means migrating the frontends later anyway, with more shared code in flight.

*Alternative considered — backend-only workspace, frontends stay on npm:* lower immediate
risk, but permanently blocks `frontend/common/`, leaves two package managers and two
lockfile styles in one repo, and makes Turborepo's affected-graph blind to the frontends
(so CI cannot tell that a change to a shared package affects `admin`). Rejected.

### D2 — Docker build contexts move to the repo root — the largest and riskiest part of this change

A direct consequence of D1. Both frontend compose files currently declare `context: .`
(the app folder) and both Dockerfiles run `npm ci` against a local lockfile. Under a
workspace there is one lockfile, at the root. Each app's compose service therefore becomes
`context: ../../..` with an explicit `dockerfile:` path, and each Dockerfile installs with
pnpm scoped to its own package.

*Why this is the right shape regardless:* backend services import `@app/*` from
`backend/common/nest-libs/`, which is **outside** their own app folder. A backend Dockerfile
can never work with an app-folder context. Every service this repo is about to grow needs a
root context, so the frontends converge on the same pattern rather than the repo carrying
two contradictory Docker conventions.

*Implementation:* prefer `pnpm deploy --filter=<pkg> --prod` (or `turbo prune --docker`) to
produce a self-contained subtree in the builder stage, so the final image does not carry the
whole monorepo. The `ENV HOSTNAME=0.0.0.0` fix and the `http://127.0.0.1:<port>` healthcheck
in `apps/admin` are load-bearing and must survive the rewrite unchanged.

*Risk acknowledged:* this touches two apps that currently work. See Risks below. If the
reviewer prefers to de-risk, the fallback is D2-alt: keep both frontends on npm with their
own lockfiles for now (accepting D1's trade-offs for the frontend half only) and apply the
workspace to `backend/**` alone. That is a smaller change, and a legitimate call — but it
should be made now, at review, not discovered mid-implementation.

### D3 — pnpm's default isolated `node_modules`, and fix `site`'s dependency declaration

Do not set `node-linker=hoisted`. Instead, promote `react` and `react-dom` in
`frontend/apps/site/package.json` from optional `peerDependencies` to real `dependencies`,
pinned to the versions it already resolves.

*Why:* `site` currently works by accident — npm hoists a transitively-installed React into a
flat `node_modules` where Vite happens to find it. That is a latent bug, not a preference.
Isolated linking surfaces exactly this class of phantom dependency, which is worth having
before nine backend services start sharing libs.

*Alternative considered — `node-linker=hoisted`:* would let `site` keep its incorrect
manifest and reduce migration friction repo-wide. Rejected: it preserves the bug and
forfeits the main correctness benefit of pnpm.

### D4 — No Postgres container in this change

`docker-compose.infra.yaml` ships Redis and MinIO only.

*Why:* database-per-service means each service owns its Postgres, its schema, and its
migration history. Since this change creates zero services, a Postgres container here would
have zero databases and would establish a shared-instance precedent that contradicts the
architecture. `DATABASE_URL` conventions are documented in `.env.example`; the first service
proposal provisions the first database.

*Alternative considered — one shared dev-only Postgres with a logical database per service:*
fewer containers for local dev, and a common pattern. Rejected for now because it blurs the
ownership boundary the architecture depends on; if container sprawl becomes a real problem
after three or four services exist, revisit it then with evidence.

### D5 — Redis and MinIO are shared, on the single `agiliz_network`

*Why shared:* cross-service BullMQ delivery only works if every producer and consumer point
at the same Redis — that is the whole mechanism behind the `supply → finance` event flow.
Object storage is likewise naturally one account-like resource, not one bucket store per
service. Unlike Postgres, these are not per-service state.

*Why one network:* the skill's `docker.md` prescribes three external networks
(`redis_network`, `shared_network`, `observability_network`), inherited from the prior
project. This repo's live convention is a single `agiliz_network`, already created
idempotently by `agiliz-cli`'s `ensure_shared_network`. The repo's actual convention wins;
the skill's multi-network pattern should be corrected separately.

### D6 — `infra` becomes an `agiliz-cli` project, first up and last down

`PROJECT_DIRECTORIES[infra]='docker/composes'`, `PROJECT_FILES[infra]='docker-compose.infra.yaml'`,
no entry in the dev/prod service maps, prepended to `UP_ORDER` and appended to `DOWN_ORDER`.

*Why:* infrastructure has no dev/prod variant, and the registry already handles that case by
resolving an absent key to an empty service name. Ordering matters because future backend
services will fail their healthchecks if Redis is not up first.

### D7 — The stale `smartparts` compose files are flagged, not touched

`docker-compose.redis.yaml`, `docker-compose.observability.yaml`, and
`docker-compose.cli.yaml` are left exactly as they are, and a new
`docker-compose.infra.yaml` is added alongside them.

*Why:* deleting or rewriting files from an unrelated project is a judgement call about
history the reviewer owns, and silently repurposing `docker-compose.redis.yaml` would bury
that decision inside an unrelated diff. Recommended follow-up: a separate
`remove-stale-compose-files` change. The root `CLAUDE.md`'s claim that `docker/composes/`
is empty is corrected as part of this change, since it is now demonstrably wrong either way.

### D8 — Package naming: the `@agiliz/*` scope

Root package `agilizai24h` (private). Workspace members: `@agiliz/admin`, `@agiliz/site`,
`@app/<lib>` for the eight `nest-libs` (matching the path alias they are already imported
under), and `@agiliz/<name>-service` for future backend apps.

*Why:* `site` is currently published-looking as `@figma/my-make-file`, a Figma Make export
artifact that means nothing here, and `admin` is the unscoped name `admin`. Turborepo
`--filter` and pnpm workspace links both key off package names, so they should be
deliberate and consistent before nine more appear.

*Note:* the `@app/*` **package names** must match the tsconfig `paths` alias so that
workspace linking and compile-time resolution agree.

### D9 — Prettier stays as-is repo-wide, including `semi: false`

The existing root `.prettierrc` (`singleQuote`, `semi: false`, `printWidth: 120`,
`arrowParens: avoid`, `trailingComma: all`) is reused unchanged for backend and frontend
alike.

*Why:* it is already the repo's convention and both frontend apps are formatted to it. NestJS
scaffolding conventionally emits `semi: true`, so backend code will differ from `nest new`
output — a one-time format pass, not a problem. One formatter config for the whole repo is
worth more than matching an upstream generator's defaults.

*Alternative considered — `semi: true` for `backend/**` only:* matches NestJS idiom but means
two formatting styles and per-directory Prettier overrides. Rejected as not worth it. Flagged
here because it is easy to reverse now and annoying to reverse after nine services exist.

### D10 — ESLint: three shared flat configs, imported per package

Root `eslint.base.mjs` (TypeScript + import hygiene, framework-agnostic), `eslint.backend.mjs`
(base + NestJS-friendly rules: decorators, parameter properties), `eslint.frontend.mjs` (base +
`eslint-config-next`). Each package keeps a one-line `eslint.config.mjs` importing its flavour.

*Why per-package files:* ESLint flat config does not cascade up from a package directory to a
workspace root the way `.eslintrc` did. A local file per package is the supported pattern.
`apps/admin`'s existing config is re-pointed at the shared frontend flavour, preserving its
`globalIgnores` for shadcn-vendored files (`src/components/ui/**`) which are CLI-regenerated
and must not be linted. `apps/site` has no ESLint config at all today; it gets the frontend
flavour, and any resulting violations are fixed or explicitly ignored in this change rather
than left to fail CI.

### D11 — The contracts convention is documented now, created later

`openspec/project.md` records the convention —
`backend/common/nest-libs/<event-family>-contracts`, scoped by event family rather than by
service pair — but no such package is created here.

*Why:* the "period data updated" event fans out to more than two services, so the pairwise
naming of the existing `quote-search-match` precedent does not generalise. Recording the rule
now prevents the first ingestion proposal from inventing a different one; creating an empty
package now would be speculative.

### D12 — Node 24 LTS, pinned in `.nvmrc` and `engines`

*Why 24:* both existing Dockerfiles already build on `node:24-alpine`. Pinning local dev to
anything else guarantees a drift between what developers run and what ships. 24 is the current
LTS and satisfies every floor in play (Next.js 16, NestJS, and the OpenSpec CLI's 20.19+).

*Environment impact, called out because it reaches beyond this repo:* the machine this was
planned on ran Node 18.20.4, which is below the OpenSpec CLI's floor; it has been moved to
24.19.0 via `n`. Other projects on the same machine share that global Node.

### D13 — CI checks out full history

`actions/checkout` with `fetch-depth: 0`.

*Why:* Turborepo's `--filter=...[origin/main]` affected-detection needs the merge-base, which a
default shallow clone does not have. Without it the filter silently matches nothing and CI
passes while testing zero packages — a failure mode that looks like success.

## Risks / Trade-offs

- **Rewriting the Docker build for two working apps (D2) breaks the devbox** → Rebuild and
  run both `dev` and `prod` targets for `admin` and `site` and confirm the `admin-prod`
  healthcheck passes, before the change is considered done. The `HOSTNAME=0.0.0.0` and
  `127.0.0.1` healthcheck fixes are explicitly re-verified, not assumed. Rollback is a
  single revert — no data or state is involved.
- **Isolated `node_modules` surfaces phantom dependencies beyond `site`'s React (D3)** →
  Expect breakage that npm's hoisting was hiding, in `site` most of all. Mitigation: fix
  manifests properly; `node-linker=hoisted` remains an escape hatch if a dependency proves
  genuinely unfixable, and that decision would be recorded rather than applied silently.
- **Writing eight `package.json` files means declaring dependencies that were never
  declared** → Derive each from the lib's actual imports (`@nestjs/bullmq`, `bullmq`,
  `ioredis` for `hold-it`; AWS SDK v3 S3 client for `aws`; ExcelJS/SheetJS for `sheeter`;
  `@prisma/client` + `@prisma/adapter-pg` for `prisma-db-client`; and so on), verified by
  reading `src/`, never guessed. Getting one wrong stays invisible until a service imports
  that path — so `typecheck` must pass across all eight libs before this change closes.
- **CI is nearly vacuous at first** → With no backend apps and no test scripts, the workflow
  mostly proves that install and graph resolution work. That is deliberate: the alternative
  is adding CI later, under pressure, alongside the first real service.
- **`agiliz-cli` gains a project with no dev/prod split** → The empty-key behaviour is
  inferred from reading the script, not from an existing infra-style entry. Exercise
  `agiliz-cli up -i infra`, `down`, and `logs` explicitly rather than trusting the reading.

## Migration Plan

1. Land the workspace files, tsconfig bases, and the eight lib manifests; `pnpm install` at
   the root; confirm `pnpm turbo run typecheck` resolves `@app/*` across all eight libs.
2. Migrate the frontends: delete both `package-lock.json`, fix `site`'s React declaration and
   package names, reinstall, and confirm `dev` and `build` still work **outside** Docker.
3. Rewrite the two Dockerfiles and compose contexts; rebuild both apps' `dev` and `prod`
   targets; confirm `admin-prod`'s healthcheck goes healthy.
4. Add the infra compose file and register `infra` in `agiliz-cli`; bring the full devbox up
   and down through the CLI.
5. Add ESLint flavours and CI last, once everything installs and builds, so lint failures are
   never confused with resolution failures.

Rollback at any step is `git revert` plus `rm -rf node_modules` and a reinstall; nothing here
holds persistent state except the named Redis/MinIO volumes, which are new and empty.

## Open Questions

- Whether `frontend/apps/site` should keep its unusual dependency pinning style (exact
  versions, no `^`) once it joins the workspace. Deferrable: it affects neither the approach
  nor the task breakdown, and can be normalised whenever `site` is next touched in earnest.

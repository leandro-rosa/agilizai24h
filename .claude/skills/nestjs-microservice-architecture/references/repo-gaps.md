# Repo-wide gaps

`backend/apps/` has been empty until now, so several pieces of monorepo
tooling this architecture assumes don't exist in this repo yet. Bootstrap
them the first time this skill scaffolds a microservice and finds them
missing — this is a deliberate choice, not an oversight to work around:
there's no such thing as a real app under `backend/apps` without a working
workspace and path-alias setup underneath it. Still, say what got created
in the new app's `CLAUDE.md` so it's visible, not a silent side effect
buried in the diff.

## Quick check

```bash
ls package.json pnpm-workspace.yaml turbo.json backend/tsconfig.json backend/common/tsconfig.json 2>/dev/null
```

If any of these are missing, bootstrap them before scaffolding the app's
own files.

## What to create, and why

**Root `package.json`** — minimal, just enough to anchor the workspace
(name, `private: true`, a `packageManager` field pinning the pnpm
version).

**Root `pnpm-workspace.yaml`**

```yaml
packages:
  - "backend/apps/*"
  - "backend/common/nest-libs/*"
```

**Root `turbo.json`** — minimal pipeline covering the scripts every app
and lib will have (`build`, `lint`, `test`):

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "lint": {},
    "test": { "dependsOn": ["^build"] }
  }
}
```

**`backend/tsconfig.json`** — the base every `backend/apps/*/tsconfig.app.json`
extends, with the `@app/*` path mapping every `nest-libs` consumer needs:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2021",
    "esModuleInterop": true,
    "declaration": true,
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@app/*": ["common/nest-libs/*/src"]
    }
  }
}
```

**`backend/common/tsconfig.json`** — the base every
`nest-libs/*/tsconfig.lib.json` extends (every existing lib's
`tsconfig.lib.json` already assumes this file exists):

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "composite": true, "declaration": true }
}
```

**Runtime path aliasing (`register-paths.js`)** — the `@app/*` mapping
above only affects the TypeScript compiler; Node doesn't know about
`tsconfig` `paths` when `require()`ing the compiled JS in `dist/`. Without
a runtime resolver, the app crashes on the first `@app/*` import once it's
actually running. A `register-paths.js` using `tsconfig-paths/register` (or
an equivalent manual mapping if that package isn't already a dependency)
at the repo root, loaded via `node -r ./register-paths.js` in the
Dockerfile's `CMD` (see [docker.md](docker.md)), closes this gap.

## Other known gaps — flag, don't silently fix

- **Shared Docker networks** (`redis_network`, `shared_network`,
  `observability_network`) referenced as `external: true` in
  [docker.md](docker.md)'s compose pattern don't exist anywhere in this
  repo yet. Unlike the tsconfig/workspace gaps above, creating these is a
  cross-app infrastructure decision (who runs the shared Redis? where does
  the root compose file live?) bigger than scaffolding a single
  microservice — raise it with the user rather than inventing a root
  compose file as a side effect of adding one app.
- **`WITH_KAFKA_BROKERS` DI gotcha** — `@app/hold-it`'s `HoldItModule`
  defaults this env var to `true`, which crashes DI unless it's explicitly
  set to `false`. See [queues.md](queues.md) for the fix; this is a lib
  bug to work around per-app, not a repo-tooling gap to bootstrap.
- **`openspec/` not initialized** — the root `CLAUDE.md` documents an
  OpenSpec (propose → apply → archive) workflow for non-trivial changes,
  but `openspec/` doesn't exist in this repo yet. Scaffolding a
  microservice is exactly the kind of non-trivial change that workflow is
  meant for — mention this to the user rather than assuming either that
  OpenSpec should be skipped or that this skill should initialize it
  unprompted.

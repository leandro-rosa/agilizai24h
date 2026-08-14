# Docker

## Multi-stage Dockerfile

Four stages — `base` → `deps` → `build` → `runtime` — on Alpine with
pnpm/corepack:

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm exec prisma generate --config backend/apps/<name>/src/modules/db-client/prisma.config.ts
RUN pnpm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod && pnpm store prune
COPY --from=build /app/dist ./dist
COPY register-paths.js ./
RUN addgroup -S app && adduser -S app -G app
USER app
EXPOSE 3000
CMD ["node", "-r", "./register-paths.js", "-r", "./dist/apps/<name>/src/tracing.js", "dist/apps/<name>/src/main.js"]
```

Why each piece is there:

- `deps` installs from the lockfile *and* `pnpm-workspace.yaml` — this
  stage doesn't work until the repo-wide workspace files exist (see
  [repo-gaps.md](repo-gaps.md)).
- `build` sets a dummy `DATABASE_URL` because `prisma generate` only reads
  the schema file to produce the client — it never actually connects. Real
  credentials aren't needed (or wanted) at build time.
- `runtime` installs prod-only deps and drops back to a non-root user —
  the build stage's dev tooling doesn't belong in the image that actually
  runs.
- `register-paths.js`, loaded via `-r` before `main.js`, resolves the
  `@app/*` aliases at runtime — TypeScript's `tsconfig` `paths` only
  affects compilation, not what Node resolves when `require()`ing the
  compiled output, so the aliases need a second resolution step at
  runtime.
- Tracing is loaded via `-r` *before* `main.js`, for the same reason
  described in [config-and-bootstrap.md](config-and-bootstrap.md) — OTel
  needs to patch modules before they're first required.
- The healthcheck uses `node -e "fetch(...)"` instead of `curl`, so the
  runtime image doesn't need to install a separate HTTP client just to
  check itself:

```dockerfile
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

Run lint/typecheck/test against the `build` stage in CI, not the slim
`runtime` image — `runtime` deliberately has none of the tooling those
steps need.

## docker-compose

Each service owns the infrastructure only it needs (its own Postgres, a
LocalStack container if it touches S3) but joins shared infrastructure as
**external** networks rather than redefining it:

```yaml
services:
  <name>-api:
    build: .
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks: [backend, redis_network, shared_network, observability_network]

  postgres:
    image: postgres:16-alpine
    healthcheck:
      test: [CMD-SHELL, pg_isready -U postgres]
    networks: [backend]

networks:
  backend: { driver: bridge }
  redis_network: { external: true }
  shared_network: { external: true }
  observability_network: { external: true }
```

The `external: true` networks (shared Redis for BullMQ, a shared
Grafana/OTel collector, a shared network the frontend BFF uses to reach
backend services by name) must already exist at the root/shared
`docker-compose` level — they're not something each app's own compose
file should try to create. If they don't exist yet in this repo, that's a
repo-wide gap to raise with the user (see
[repo-gaps.md](repo-gaps.md)), not something to silently work around by
making the networks non-external.

## Review checklist

- [ ] Dockerfile has the four stages, in order, with dev tooling confined to `build` and dropped from `runtime`.
- [ ] `runtime` runs as a non-root user.
- [ ] `register-paths.js` and the tracing entrypoint are both loaded via `-r` before `main.js`.
- [ ] Healthcheck uses `node -e "fetch(...)"`, not a `curl` dependency.
- [ ] compose only defines infrastructure this app owns; shared infrastructure is joined via `external: true` networks.

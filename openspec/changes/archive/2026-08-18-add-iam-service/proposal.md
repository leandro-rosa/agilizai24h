## Why

`frontend/apps/admin` has no authentication at all — it opens straight onto the
dashboard, an explicit v1 decision. The panel exposes every store's revenue, cost and
loss figures, so it cannot reach real data without an identity boundary in front of it.
Nothing in this repo models users, sessions, or permissions today, in any layer.

This is the first real microservice, so it also establishes the per-service pattern
(own Postgres database, own Prisma schema and migration history, typed env config,
health checks, Docker + `agiliz-cli` registration) that the eight services after it copy.

## What Changes

- **New `backend/apps/iam-service`** — a NestJS HTTP service owning users, credentials,
  sessions and permissions, with its own Postgres database.
- **Session-based authentication** — login exchanges credentials for an opaque server-side
  session; logout revokes it. No JWTs: sessions must be revocable immediately, and the
  gateway is the only client.
- **A session-introspection endpoint** — the mechanism `gateway-service` will call
  synchronously on every request to resolve a session into a user and permission set.
- **A permission model** — roles carrying permissions, checked per operation, so a future
  store-level operator can be prevented from reading consolidated finance data.
- **Operator seeding** — a documented way to create the first administrator, since there
  is no self-registration flow (operators are Agiliz.AI staff, not public signups).

Not in scope: the gateway that calls this service (`add-gateway-service`), the login UI
(`add-web-real-data`), password reset, SSO, and multi-tenancy.

## Capabilities

### New Capabilities

- `iam`: user accounts, credential verification, session lifecycle, and the permission
  model that every other service's access decisions are derived from.

### Modified Capabilities

None. `openspec/specs/` currently contains no capabilities.

## Impact

- **New**: `backend/apps/iam-service/` (NestJS app, Prisma schema, migrations, Dockerfile,
  `docker-compose.yml`, `CLAUDE.md`, `.env.example`), plus its own Postgres container.
- **Modified**: `cli/agiliz-cli` (new `iam` project, ordered after `infra`),
  `cli/CLAUDE.md`, `backend/CLAUDE.md` (first entry under `apps/`).
- **Depends on**: the `infra` Redis from `add-monorepo-foundation` only if sessions are
  stored there rather than in Postgres — see `design.md`.
- **Consumed by**: `add-gateway-service`, which becomes its only network client. No other
  service talks to it directly.
- **Security**: introduces credential storage and session secrets. Password hashing
  parameters and session lifetimes become security-relevant configuration.

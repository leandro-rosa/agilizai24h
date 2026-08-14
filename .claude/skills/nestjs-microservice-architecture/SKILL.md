---
name: nestjs-microservice-architecture
description: >-
  Defines this monorepo's standard NestJS microservice architecture under
  backend/apps: module layout, Prisma+adapter-pg database access, BullMQ
  queues via @app/hold-it, env config, Fastify bootstrap, 3-tier testing,
  multi-stage Docker, and per-module CLAUDE.md docs. Use this whenever
  creating a new microservice under backend/apps, scaffolding its
  controller/service/repository/queue producer+worker/config/Dockerfile,
  reviewing an existing backend/apps service for architecture drift, or
  wiring database access, queues, env validation, tests, or Docker into
  any NestJS app here — even if the user just says "set up a new
  service," "add a microservice," "wire up the database," "add a
  queue/worker," or "add Docker to this app" without saying NestJS or
  architecture explicitly. Also bootstraps missing repo-wide tooling this
  assumes (pnpm-workspace.yaml, turbo.json, tsconfig bases, @app/* path
  aliases, register-paths.js) and flags the WITH_KAFKA_BROKERS DI gotcha
  in @app/hold-it.
---

# NestJS microservice architecture

This skill defines the target architecture for every NestJS microservice
that lives under `backend/apps/<name>` in this monorepo. It's a pattern to
apply consistently across services, not a shared library to import — each
new service gets its own copy of this structure, wired to the shared
`backend/common/nest-libs/*` (`@app/*`) packages where it makes sense.

The pattern below was distilled from a real microservice examined while
designing this skill. That source is not part of this repo and won't be
referenced by path anywhere here — treat every rule below as this repo's
own convention, not a pointer back to something external. Don't reuse any
specific business vocabulary while scaffolding; the examples here use a
neutral placeholder domain (`Widget`) precisely so nothing domain-specific
leaks into a new service.

## Check this first: repo-wide gaps

Several pieces of tooling this pattern assumes — a pnpm workspace, a root
`tsconfig.json`, the `@app/*` path aliases — don't exist in this repo yet,
because `backend/apps/` has been empty until now. Read
[references/repo-gaps.md](references/repo-gaps.md) before scaffolding the
first microservice: the workflow below bootstraps these automatically the
first time they're missing, since a working monorepo layout is a
prerequisite for having any real app under `backend/apps` at all. This
isn't a silent side effect — call out what got bootstrapped in the new
app's `CLAUDE.md`.

## Workflow

Pick the path that matches the request:

**1. Creating a new microservice**
1. Check/bootstrap repo-wide gaps — [references/repo-gaps.md](references/repo-gaps.md).
2. Create `backend/apps/<name>/` and scaffold `src/main.ts`, `src/tracing.ts`,
   `src/app.module.ts`, `src/config/env.validation.ts` — see
   [references/config-and-bootstrap.md](references/config-and-bootstrap.md)
   and the templates in `assets/`.
3. If the service needs Postgres, add `src/modules/db-client/` — see
   [references/database.md](references/database.md).
4. Add the first feature module: controller → service → repository, plus a
   producer/worker pair only if the feature has real async work — see
   [references/module-structure.md](references/module-structure.md) and
   [references/queues.md](references/queues.md).
5. Add `Dockerfile` + `docker-compose.yaml` — see
   [references/docker.md](references/docker.md).
6. Add tests per [references/testing.md](references/testing.md) as the
   code is written, not as an afterthought.
7. Write a `CLAUDE.md` for the new app (public API, consumers, known
   gaps — same convention as every `backend/common/nest-libs/*` package),
   and link it from `backend/CLAUDE.md`'s app index.

**2. Reviewing an existing microservice for architecture consistency**
Walk each reference file's review checklist against the app in question
and report deviations. Don't silently rewrite anything — flag what's off
and let the user decide whether it's a deliberate deviation or drift.

**3. Wiring a single concern into an existing app**
Jump straight to the matching reference file below — no need to touch
anything else.

## Layering

- **Synchronous work**: Controller → Service → Repository.
- **Asynchronous work**: Producer → BullMQ queue → Worker, via `@app/hold-it`.

This is a pragmatic layered architecture, not hexagonal/clean architecture
— there's no ports-and-adapters abstraction and no domain layer fully
independent of the persistence model. Don't introduce one unless the
service's complexity actually earns it.

## Reference files

| Concern | File | What's in it |
|---|---|---|
| Folder/module layout | [references/module-structure.md](references/module-structure.md) | App and feature-module folder tree, the `@Global()` shared-module rule for BullMQ workers, DTO vocabulary validation, naming boundaries |
| Database | [references/database.md](references/database.md) | Prisma + `@prisma/adapter-pg`, schema conventions, `db-client.module.ts`, repositories, concurrency control |
| Queues | [references/queues.md](references/queues.md) | `@app/hold-it` usage, versioned job envelopes, idempotency, the `WITH_KAFKA_BROKERS` gotcha |
| Config & bootstrap | [references/config-and-bootstrap.md](references/config-and-bootstrap.md) | Fastify, `tracing.ts` as a separate entrypoint, env validation, health checks |
| Testing | [references/testing.md](references/testing.md) | The three test tiers and when each applies |
| Docker | [references/docker.md](references/docker.md) | Multi-stage build, runtime path aliasing, compose networking |
| Repo-wide gaps | [references/repo-gaps.md](references/repo-gaps.md) | What monorepo tooling is missing and how to bootstrap it |

## The `@app/*` shared libraries

`backend/common/nest-libs/*` are shared NestJS libraries, each imported as
`@app/<lib-name>`. Reach for them instead of adding a competing dependency:

| Lib | Reach for it when... |
|---|---|
| `@app/aws` | The service needs to read/write S3 (or an S3-compatible endpoint like MinIO/LocalStack). |
| `@app/elasticsearch` | The service needs Elasticsearch search/pagination. |
| `@app/health` | Always — mount it in `app.module.ts` for a `/health` endpoint; bind your DB client to its injection token if the service has one. |
| `@app/hold-it` | Always, for any BullMQ queue or worker — never add `bullmq`/`@nestjs/bullmq` directly. |
| `@app/http-client` | The service calls another HTTP or GraphQL API and wants retry/backoff for free. |
| `@app/prisma-db-client` | Always, if the service uses Postgres — extend its `PrismaRepository<T, Model>` base class per table. |
| `@app/sheeter` | The service reads or writes spreadsheets/CSV. |
| `@app/quote-search-match`-style contract package | Not a lib to depend on directly — it's an example of a *pattern*: when two independently-deployed apps share a queue, extract a dedicated no-logic package holding just the queue-name constants and envelope/payload types. Replicate the pattern with names that fit the two services actually involved, not this one's contents. |

## Every module and app gets a `CLAUDE.md`

Following the convention already established for `backend/common/nest-libs/*`:
document public API, consumers, and known gaps — nothing that's already
obvious from the code, no generic prose. This applies to the app root and
to each feature module under `src/modules/`.

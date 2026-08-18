# Agiliz.AI — project context

Canonical context for every OpenSpec change in this monorepo. `openspec/config.yaml`
carries a condensed version of the hard constraints inline (the CLI injects it into
artifact generation); this file is the full reference.

Agiliz.AI operates a network of unattended micro-market stores (self-checkout
convenience points) inside partner companies and condominiums in Brazil, today
running on a third-party POS platform (touchpay/AmLabs). This platform replaces the
manual, spreadsheet-based monthly reconciliation of that operation with a real system.

## Tech stack

Decided by the business owner. Not open for silent substitution — a change that
believes one of these is wrong must argue it in its own `design.md`.

| Concern | Decision |
|---|---|
| Backend framework | NestJS, independent microservices under `backend/apps/<name>` — never a monolith with modules pretending to be services |
| Sync inter-service comms | HTTP (REST, typed DTOs) via `@app/http-client` — when the caller needs an immediate response |
| Async inter-service comms | BullMQ via `@app/hold-it` — background jobs, fan-out, anything that must not block the caller |
| Database engine | PostgreSQL, always |
| Data ownership | Database-per-service: each microservice owns its own physical Postgres database; no service queries another service's tables |
| ORM | Prisma, via `@app/prisma-db-client`'s `PrismaRepository<T, Model>` base — one schema/client and one migration history per service |
| Object storage | S3-compatible via `@app/aws`'s `S3Service` (MinIO/LocalStack in dev). Raw uploaded files live here; Postgres holds only parsed, structured data |
| Frontend framework | Next.js — `frontend/apps/admin` is the reference implementation. Do not follow `frontend/apps/site`'s MUI-mixed pattern |
| UI components | shadcn/ui on Radix, vendored via the CLI (`components.json`), matching `apps/admin` |
| State / data-fetching | RTK + RTK Query. `apps/admin`'s six `mockBaseQuery` slices swap to `fetchBaseQuery` as each backend domain service lands |
| Authentication | Session-based. Does not exist anywhere yet — `apps/admin` has no auth at all |
| Processing model | All non-trivial processing (upload parsing, reconciliation, recomputation) runs through BullMQ via `@app/hold-it`. No synchronous heavy processing inside an HTTP request handler |
| Monorepo tooling | Turborepo + pnpm workspaces |
| Language | All code, comments, commit messages, API contracts, and OpenSpec artifacts in **English**. UI copy (labels, titles, badges) stays in **Portuguese** — the operators are Brazilian. See the glossary below |

## Target architecture

Nine services. The six domain services map 1:1 to `frontend/apps/admin`'s six route
modules, deliberately: the frontend's route vocabulary is the established domain
vocabulary, and keeping the names aligned keeps the RTK Query slice → backend service
mapping obvious.

```
backend/apps/
  gateway-service/           BFF — the only service the frontend talks to. Thin: routing,
                             auth-check delegation, request aggregation. No database of its
                             own beyond a possible session cache.
  iam-service/               Users, sessions, auth, permissions.
  stores-service/            Stores — CRUD + read APIs.
  products-service/          Products/SKUs + the dated/versioned canonical cost reference.
  sales-service/             Persisted sales records from ingested sales reports.
  supply-service/            Restock/removal records + loss classification (see below).
  finance-service/           COGS, remaining-stock value, loss aggregation, per-store/
                             per-month reconciliation reads.
  inventory-service/         Current stock levels derived from restock + sales.
  ingestion-worker-service/  BullMQ consumers (HoldItWorkerHost) turning uploaded
                             spreadsheets (via @app/sheeter) into normalized records.
backend/common/nest-libs/    The 8 vendored libs below.
frontend/apps/admin/         Next.js management panel — already exists, currently mocked.
```

### Why six domain services rather than a merged reconciliation service

`supply`, `finance`, and `inventory` are tightly coupled in the business domain, which
invites merging them. They stay separate because each is a distinct single-writer
bounded context over the same event stream:

- `supply-service` is the **write side** — it owns restock/removal records and the loss
  classification rules, a genuine ingestion + business-rule workflow.
- `inventory-service` derives a **quantity** ledger from restock + sales.
- `finance-service` derives a **monetary** reconciliation from the same data plus cost.

The coupling between them is event-shaped, not transactional, so it is expressed with
`@app/hold-it` events (e.g. `supply-service` emits "period data updated", which triggers
recomputation in `finance-service`) rather than shared tables or a merged service. This
is what `hold-it` was vendored for.

### Communication matrix

| From → To | Mechanism | Why |
|---|---|---|
| `apps/admin` → `gateway-service` | HTTP | user-facing requests, replacing each domain's `mockBaseQuery` |
| `gateway-service` → `iam-service` | HTTP (`@app/http-client`) | session/permission checks must be synchronous |
| `gateway-service` → `stores-service` / `products-service` | HTTP | read-heavy lookups |
| `gateway-service` → `finance-service` | HTTP | dashboard reads |
| `gateway-service` upload endpoint → `ingestion-worker-service` | HTTP in, `@app/hold-it` out | upload returns fast; parsing must not block the request |
| `ingestion-worker-service` → `sales` / `supply` / `products` services | `@app/hold-it` | persists normalized rows as they are parsed |
| `supply-service` → `finance-service` | `@app/hold-it` (event: period data updated) | triggers recomputation without coupling the parser to reconciliation internals |
| `finance-service` / `supply-service` → `products-service` | HTTP | needs the dated cost reference to value a period |

### Shared contracts

BullMQ job payload shapes are defined once and imported — never duplicated per service.
Convention: `backend/common/nest-libs/<event-family>-contracts`, scoped by **event
family** rather than by service pair (a "period data updated" event fans out to more
than two services, so pairwise naming does not scale). `quote-search-match` is the
existing precedent for a logic-free contracts package living alongside the other libs.

## Internal libraries (`backend/common/nest-libs/`)

Eight vendored libs, all `@Global()` NestJS modules configured via env vars, exposed to
apps under the `@app/*` path alias. Use them as designed rather than re-implementing
their responsibility inside a service. Each has its own `CLAUDE.md` with the full public
API; this table is the index.

| Lib | Purpose |
|---|---|
| `@app/aws` | `S3Service` (upload/download) over AWS SDK v3, S3-endpoint compatible (MinIO/LocalStack) |
| `@app/elasticsearch` | `@elastic/elasticsearch` wrapper with PIT pagination, `search`/`mget` |
| `@app/health` | Generic `@nestjs/terminus` health-check module, ORM-agnostic |
| `@app/hold-it` | Message-broker abstraction (BullMQ working, Kafka has a known gap) + workers + Bull Board |
| `@app/http-client` | `@nestjs/axios` with retry/backoff + a GraphQL convenience layer |
| `@app/prisma-db-client` | Schema-agnostic `PrismaRepository<T, Model>` base repository |
| `@app/quote-search-match` | Contract-only (queue names + types) between a quote app and a search app — neither exists here |
| `@app/sheeter` | Spreadsheet/CSV read+write over `hold-it` + `aws` |

Composition: `hold-it` is the base that `elasticsearch`, `aws`, and `sheeter` build on.

### Standing gotchas

- **`WITH_KAFKA_BROKERS` must be `false` in every service that registers `HoldItModule`.**
  It defaults to `true` when unset, which pulls in `HoldItKafkaBroker` → requires
  `HoldItElasticsearchService` → never provided → NestJS DI fails at startup. Set it
  explicitly in env, docker-compose, and test setup. It is baked into the shared
  `.env.example` template so no new service can miss it.
- **`PrismaRepository` swallows Prisma error codes** — errors are logged then rethrown as
  a generic `Error`, so `error.code` is not available to callers. Any service that needs
  to branch on a specific Prisma error (e.g. unique-constraint violation for upload
  dedup) must account for this in its design rather than assuming the code is there.
- **Next.js standalone in Docker** (already solved in `frontend/apps/admin`): the
  standalone `server.js` binds to `$HOSTNAME`, which Docker auto-sets to the container
  ID, so `ENV HOSTNAME=0.0.0.0` is required or the server listens only on the container's
  own IP. And Alpine's `wget` resolves `localhost` to `::1` first while Next listens on
  IPv4 only, so healthchecks must target `http://127.0.0.1:<port>` explicitly.

## Domain rules

### Loss classification

Validated against several months of production data from the source system. This is
first-class business logic, not an implementation detail.

- **Counts as real loss**: Expired (`Validade vencida`), Damaged product
  (`Produto danificado`), Other reason (`Outro motivo`).
- **Does NOT count as loss**: Return (`Devolução`), Transfer (`Transferência`),
  Internal use (`Uso e consumo`).
- **A single removal line can mix reasons** — e.g. `-6 Devolução, -3 Outro motivo` means
  3 units of loss and 6 units of non-loss. The parser splits per reason within the line
  and never classifies a whole line as one bucket.
- **Cost matching is not an exact string match** between the POS product name and the
  canonical price sheet. Strategy: normalize (case, accents, whitespace) first, then fall
  back to a manually-curated override table for known mismatches. Any SKU that cannot be
  priced is **reported**, never silently dropped from totals.
- **Costs are dated/versioned.** A month's reconciliation is valued with the cost that
  was current for that month — re-displaying a historical month never reprices it with
  today's cost sheet.

### Ingestion sources

Three spreadsheet types, uploaded by operators through the app:

1. **Sales report** — one file per store: SKU, quantity sold, revenue.
2. **Restocking/removal report** — one file per month, one sheet per site visit: per SKU,
   quantity restocked plus a free-text `Removals` reason breakdown (see the mixed-reason
   rule above).
3. **Price/cost reference** — canonical cost per SKU, used to value everything in currency.

Each file type gets its own `queueCallbackName` and its own `HoldItWorkerHost` consumer
in `ingestion-worker-service`, rather than one generic "parse anything" queue.

From these, the platform computes — per store, per month — restocked value, COGS,
remaining stock value, and real loss broken down by reason and by product.

## Domain glossary (Portuguese → English)

Used consistently across code, DB columns, DTOs, and specs. Do not invent alternate
translations mid-project. Where a term already has an English name in `apps/admin`'s
routes, that name wins.

| Portuguese (business term) | English (code term) |
|---|---|
| Loja | Store |
| Venda / Vendido | Sale / Sold |
| Abastecimento / Abastecido | Supply / Restock(ed) — `apps/admin` route is `supply` |
| Custo | Cost |
| Perda | Loss |
| Perda real | Real loss (loss-counting reasons only) |
| Motivo (da remoção) | Reason (for the removal) |
| Validade vencida | Expired |
| Produto danificado | Damaged product |
| Outro motivo | Other reason |
| Devolução | Return |
| Transferência | Transfer |
| Uso e consumo | Internal use |
| Remoções | Removals |
| CMV (Custo da Mercadoria Vendida) | COGS (Cost of Goods Sold) |
| Sobra (de estoque) | Remaining stock (value) — `apps/admin` route is `inventory` |
| Planilha de preços | Price/cost reference sheet |
| Relatório de venda | Sales report |
| SKU / Produto | SKU / Product |
| Financeiro | Finance — `apps/admin` route is `finance` |

## Engineering standards

Standing rules for every service. A change does not get to opt out silently.

- **Lint/format** — ESLint + Prettier from the shared root config. Flat ESLint config
  (Next 16 removed `next lint`); each package imports the backend or frontend flavor.
- **Testing** — unit tests per service; integration tests against a real Postgres
  (Testcontainers or docker-compose) for anything touching Prisma; an e2e test for the
  full upload → parse → reconcile → dashboard-read path. `hold-it`'s own worker
  integration tests (`services/brokers/bull-mq/worker/index.integration-spec.ts`, real
  Redis, no mocks) are the reference pattern for testing anything BullMQ-based.
  The loss-classification rules need explicit fixtures for: single reason, mixed reasons,
  non-loss-only, unmatched SKU cost, historical cost versioning.
- **API contracts** — OpenAPI/Swagger generated per HTTP service. BullMQ payload shapes
  defined once in a shared contracts package (see above), never duplicated.
- **DB migrations** — Prisma Migrate, one migration history per service, never shared.
- **Env config** — typed and validated at boot, failing fast on missing/invalid values.
  No ad-hoc `process.env` reads in business logic. Every service's `.env.example`
  includes `WITH_KAFKA_BROKERS=false`.
- **Logging** — structured, with a correlation/request ID propagated across HTTP calls
  and carried into any `hold-it` job they enqueue, so one upload traces end to end.
- **Health checks** — liveness/readiness via `@app/health`, never a hand-rolled controller.
- **Docker** — multi-stage Dockerfile per service, joined to the external `agiliz_network`
  (never Compose's default per-project network), registered in `cli/agiliz-cli`'s static
  project registry (`VALID_PROJECTS`, `PROJECT_DIRECTORIES`, `PROJECT_FILES`, position in
  `UP_ORDER`/`DOWN_ORDER`, and the dev/prod service maps where applicable).
- **CI** — GitHub Actions running lint, typecheck, unit tests, and affected-only
  integration tests (via Turborepo) on every PR.
- **Commits** — Conventional Commits. PRs reference the OpenSpec change-id they implement.
- **Secrets** — never committed. `.env.example` per service documents required variables
  without values.

## OpenSpec workflow

- One capability = one spec folder under `openspec/specs/<capability>/spec.md`. Initial
  capability boundaries: `iam`, `stores`, `products`, `sales`, `supply`, `finance`,
  `inventory`, `ingestion`, `web-admin`.
- Every change lives under `openspec/changes/<change-id>/`. `design.md` only when the
  change is architecturally significant (new service, new cross-service contract, new
  async flow) — lean otherwise.
- `change-id` is kebab-case and verb-led (`add-`, `update-`, `remove-`, `refactor-`).
- Every requirement in a delta spec gets at least one `#### Scenario:` in GIVEN/WHEN/THEN
  form.
- `openspec validate <change-id> --strict` passes before a proposal is presented.
- Implementation does not start until the human explicitly approves the proposal.

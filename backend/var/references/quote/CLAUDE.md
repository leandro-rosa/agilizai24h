# apps/quote — Claude Code Guide

`quote` is the one microservice under `backend/apps/` today (NestJS,
Fastify). It owns the full B2B quotation lifecycle: receiving line items
either from an uploaded spreadsheet or a partner API, matching each item
against a product catalog, routing matches through human review, and
generating an export once review is complete — with every step logged to
an audit trail. See each module's own `CLAUDE.md` under `src/modules/*`
for API/job/business-rule detail (`db-client`, `quotes`,
`product-catalog-seed`); this file covers only what's common to the whole
service.

Architecture: `Controller → Service → Repository` for synchronous reads/
writes, `Producer → BullMQ queue → Worker` (via `common/nest-libs/hold-it`)
for the longer-running steps (parsing an upload, matching an item,
generating an export). Shared libraries live in `backend/common/nest-libs/`
— each has its own `CLAUDE.md`; `hold-it` is worth reading first since
every queue-related piece in this app is built on it.

This file is referenced from several code comments
(`process-upload.producer.ts`, `match-item.producer.ts`, `schema.prisma`,
`create-quote.dto.ts`, ...) under the title "Decisões pendentes".

## Resolved Architectural Decisions (referenced in code comments as "Decisões pendentes")

Decisions made for the full migration of frontend fixtures
(`frontend/src/domain/fixtures.ts`, `frontend/src/domain/partner-quote-fixtures.ts`)
to real data served by this app. Full public contract in
`frontend/docs/api-contracts.md`, "Quotation (Cotação)" section.

- **Upload column mapping**: configured via `PATCH /quotes/:id/mapping`,
  persisted in `Quote.column_mapping`/`ColumnMappingTemplate` (reusable
  across quotes). `ProcessUploadWorker` uses the `Quote`'s
  `selected_sheet`/`header_row` to pick the sheet and header row when
  parsing via `SheeterProcessorService`.
- **Automatic matching provider — both origins**: the real `product-bundle`
  catalog via `backend/apps/search`, reached
  asynchronously over `@app/hold-it` (BullMQ) rather than a direct HTTP
  call — see `src/modules/quotes/CLAUDE.md`, "Jobs", and
  `openspec/changes/improve-quote-matching-search-config/design.md`.
  `apps/search` queries protected identifiers internally but returns only
  safe field/kind evidence, never identifier values. `quote-demo-products`
  remains an explicitly static demo index for demo-only behavior and is not
  an automatic matching authority.
- **Status vocabulary**: `Quote.status`, `QuoteItem.match_status`, and
  `QuoteItem.review_decision` remain `String` columns (not Prisma `enum`) —
  the vocabulary comes from the TypeScript unions already in
  `frontend/src/domain/model.ts` (`QuoteStatus`, `MatchStatus`,
  `ReviewDecision`) and is validated at the DTO layer
  (`class-validator`'s `@IsIn([...])`), not in the schema. This avoids a
  database migration every time the vocabulary changes.
- **File persistence**: real S3 via `common/nest-libs/aws`, pointed at a
  **LocalStack** service (`SERVICES=s3`) added to
  `backend/apps/quote/docker-compose.yaml` — simulates real S3 in local
  development without depending on an AWS account. The variables already
  existed commented out in `backend/.env.example`; this decision activates
  them.
- **User identity (`created_by`/`reviewed_by`/`actor`)**: no authentication
  library exists in `common/nest-libs` today. An `x-demo-actor` header set
  by `frontend/server` (the BFF) is used as a plain string identifier —
  **must never be described as authentication or authorization** in code,
  comments, or documentation. Real authentication is an open item, tracked
  in `frontend/docs/api-contracts.md`.
- **Single `Quote`/`QuoteItem` origin**: one table family with a
  discriminator column, `Quote.source: spreadsheet | partner_api`, instead
  of two separate model families — review, score, and timeline apply
  identically to both origins. The discriminator is internal to the
  backend; the frontend's BFF always returns `Quote`/`QuoteItem` and
  `PartnerQuote`/`PartnerQuoteLine` as distinct types (this non-merging is
  a frontend contract rule, see `frontend/src/domain/model.ts`), never a
  unified type with optional fields.

## Naming boundaries

Prisma models use PascalCase and map with `@@map` to singular snake_case
tables. Persisted fields and quote-owned API fields use snake_case, including
`column_mapping`, `selected_sheet`, `header_row`, `total_rows`,
`processed_rows`, `reviewed_rows`, `matched_rows`, `unmatched_rows`,
`ambiguous_rows`, `invalid_rows`, `duplicate_rows`, `created_by`, and
`reviewed_by`.

Do not apply that persistence convention across integration boundaries. Partner
intake request names remain camelCase (`displayName`, `partnerName`,
`externalId`, `originalFields`), as do queue envelope and payload names such as
`schemaVersion`, `quoteId`, `emittedAt`, `itemId`, and `searchFields`. Translate
these contracts explicitly when writing or reading persisted records.

## Testing philosophy

Followed since Fase 6: infrastructure behavior (Postgres, Redis/BullMQ) is
validated against real infra, never mocks — a mocked repository or broker
proves the code calls the right API, not that the query or job actually
works. Pure orchestration logic (validation, delegation, defaults) is
tested in isolation, with I/O dependencies replaced by doubles. For the
current layer-by-layer test-file mapping, see
`backend/apps/quote/docs/test-coverage.md` (updated as tests are added;
not authoritative for architecture).

Known gap: there is no e2e test that boots the whole app and hits
`POST /quotes` against real Postgres — today that path is covered in two
separate pieces (`quotes.controller.spec.ts` unit test +
`quote.repository.integration-spec.ts` against the repository), but the
HTTP → controller → service → repository → Postgres seam never runs as a
single test.

## Local development

Redis is no longer part of this compose file — it's shared infrastructure
at the repository root (`docker-compose.redis.yaml`), since the
partner-API quote matching flow (see "Jobs" in
`src/modules/quotes/CLAUDE.md`) requires `apps/quote` and `apps/search` to
exchange BullMQ jobs over the same Redis instance. Bring it up first:

```
docker compose -f ../../../docker-compose.redis.yaml up --build -d
```

Then:

```
docker compose up --build          # postgres, localstack, elasticsearch, quote-api
```

Run from `backend/apps/quote/` (this compose file is quote-owned; the
`grafana` container it exports traces/metrics to, and the `redis`
container it depends on, are shared infrastructure owned by the repository
root — see root `README.md`).

All quality gates run through Docker, consistent with `frontend/`'s
pattern (see `.claude/CLAUDE.md`). `quote-api`'s running image is built
from the Dockerfile's `runtime` stage (`pnpm install --prod` — no
lint/typecheck/test tooling by design), so quality gates run against a
throwaway image built from the earlier `build` stage instead (run from the
repository root, since the build context is the `backend/` workspace):

```
docker build --target build -f backend/apps/quote/Dockerfile -t smartparts-backend-quote-api:devtools backend
docker run --rm smartparts-backend-quote-api:devtools sh -lc 'pnpm lint'
docker run --rm smartparts-backend-quote-api:devtools sh -lc 'pnpm typecheck'
docker run --rm smartparts-backend-quote-api:devtools sh -lc 'pnpm run build'
docker run --rm smartparts-backend-quote-api:devtools sh -lc 'pnpm test'              # unit + e2e specs, no external infra needed
```

`test:integration`/`test:coverage` need both Postgres (on quote's own
`smartparts-backend_smartparts-backend` network) and the shared Redis (on
the repository-root `redis_network`) reachable at once — `docker run` only
accepts one `--network` at container creation, so join the second one with
`docker network connect` before running the test command:

```
docker run -d --name quote-devtools-it --network smartparts-backend_smartparts-backend \
  -e DATABASE_URL='postgresql://quote:quote@postgres:5432/quote?schema=public' \
  -e REDIS_QUEUE_HOST=smartparts-redis -e REDIS_QUEUE_PORT=6379 \
  smartparts-backend-quote-api:devtools sleep infinity
docker network connect redis_network quote-devtools-it
docker exec quote-devtools-it sh -lc 'pnpm test:integration'                          # needs postgres+redis, already up via `docker compose up`
docker exec quote-devtools-it sh -lc 'pnpm test:coverage'                             # scoped to apps/quote/src; run with postgres+redis reachable —
                                                                                        # health.e2e-spec.ts crashes the coverage-instrumented Jest
                                                                                        # worker if Postgres is unreachable, unlike plain `pnpm test`
docker rm -f quote-devtools-it
```

## CI

`.github/workflows/backend-ci.yml` runs the same lint/typecheck/build/test/
test:integration sequence (with Postgres+Redis as service containers) plus
a production-image build, on every push/PR touching `backend/**`. No CD
step — no deploy target (registry, cloud, k8s) is confirmed anywhere in
this repo.

## Observability

`src/tracing.ts` (loaded via `node -r`, before `main.ts`) sends
traces+metrics to the `grafana` container's embedded OTel collector. That
container is not defined here — it's shared infrastructure owned by the
repository root's `docker-compose.observability.yaml`, reached via the
`observability_network` external network joined in
`backend/apps/quote/docker-compose.yaml`.
`backend/apps/quote/observability/grafana/` holds the provisioned
dashboard and alert rules for `quote-api`, mounted into that container by
the root compose file.

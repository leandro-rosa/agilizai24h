## 1. Service skeleton

- [ ] 1.1 Scaffold `backend/apps/sales-service` (`@agiliz/sales-service`), cloning the structure established by `iam-service`
- [ ] 1.2 Add `build`, `dev`, `lint`, `typecheck`, `test` scripts and the shared `eslint.backend.mjs` flavour
- [ ] 1.3 Typed env config validated at boot; liveness/readiness via `@app/health`; structured logging carrying the inbound correlation ID
- [ ] 1.4 Register `HoldItModule` for the queue this service consumes, and set `WITH_KAFKA_BROKERS=false` in env, docker-compose and test setup — omitting it crashes NestJS DI at startup

## 2. Database

- [ ] 2.1 This service's own Postgres on `agiliz_network`
- [ ] 2.2 Prisma schema: sales rows keyed by store, period and SKU, with quantity, revenue and an ingestion reference
- [ ] 2.3 Unique constraint on (store, period, SKU) so the grain is enforced by the database, not only by application logic
- [ ] 2.4 Store revenue as integer minor units — no floats in the schema or DTOs
- [ ] 2.5 Index the (store, period) read path, which is how every consumer queries
- [ ] 2.6 Initial Prisma migration owned solely by this service; repositories on `PrismaRepository<T, Model>`

## 3. Ingestion writes

- [ ] 3.1 Implement a `HoldItWorkerHost` consumer for parsed sales rows produced by `ingestion-worker-service`
- [ ] 3.2 Make ingestion idempotent per (store, period): replace that period's rows wholesale rather than upserting row by row, so SKUs absent from a corrected report are removed
- [ ] 3.3 Apply the replacement in a single transaction, so a failure mid-ingestion cannot leave a period half-replaced
- [ ] 3.4 Leave other periods and other stores untouched by a period replacement
- [ ] 3.5 Record the originating ingestion reference on every row, updating it on replacement
- [ ] 3.6 Carry the correlation ID from the job payload into this service's logs, so an upload traces end to end

## 4. Reads

- [ ] 4.1 Implement reading all SKU rows for a store and period
- [ ] 4.2 Implement aggregated totals for a store and period, computed in the database rather than in application code
- [ ] 4.3 Distinguish "period never ingested" from "period with zero sales" — never return zeroes for the former
- [ ] 4.4 Apply a deterministic sort so repeated identical reads return a stable order

## 5. HTTP surface

- [ ] 5.1 Read endpoints for per-SKU rows and totals, with typed DTOs and validation
- [ ] 5.2 Generate the OpenAPI/Swagger document, stating the money unit on every monetary field
- [ ] 5.3 Define the queue payload shape in the shared contracts location so `ingestion-worker-service` imports it rather than duplicating it
- [ ] 5.4 Use the glossary terms from `openspec/project.md` (Sale/Sold, Store, SKU)

## 6. Tests

- [ ] 6.1 Unit tests for aggregation and for the period-replacement logic
- [ ] 6.2 Integration tests against a real Postgres covering every scenario in the `sales` spec
- [ ] 6.3 **Idempotency tests**: same report twice leaves figures unchanged; corrected report replaces; a SKU dropped from the corrected report disappears; other periods untouched
- [ ] 6.4 Test that "no data" is distinguishable from "zero sales"
- [ ] 6.5 Worker integration test against a real Redis, following `@app/hold-it`'s own integration-spec pattern

## 7. Docker and CLI

- [ ] 7.1 Multi-stage Dockerfile with a repo-root build context; start via `node -r ./register-paths.js`
- [ ] 7.2 `docker-compose.yml` on `agiliz_network` with a `127.0.0.1` healthcheck, and no published host port (internal-only, per the gateway's topology rule)
- [ ] 7.3 Register `sales` in `cli/agiliz-cli` after `infra`, updating `--help` and completion candidates

## 8. Documentation

- [ ] 8.1 Write `backend/apps/sales-service/CLAUDE.md`, calling out the record grain and the idempotency contract
- [ ] 8.2 List the service in `backend/CLAUDE.md` and `cli/CLAUDE.md`

## 9. Verification

- [ ] 9.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [ ] 9.2 `agiliz-cli up -i infra -i sales` brings the service up healthy
- [ ] 9.3 Enqueue a parsed-sales job twice and confirm the stored figures do not double
- [ ] 9.4 `openspec validate add-sales-service --strict` passes

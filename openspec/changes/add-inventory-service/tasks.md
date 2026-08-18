## 1. Service skeleton

- [ ] 1.1 Scaffold `backend/apps/inventory-service` (`@agiliz/inventory-service`) in the workspace
- [ ] 1.2 Add `build`, `dev`, `lint`, `typecheck`, `test` scripts and the shared `eslint.backend.mjs` flavour
- [ ] 1.3 Typed env config validated at boot; liveness/readiness via `@app/health`; structured logging carrying the correlation ID
- [ ] 1.4 Register `HoldItModule` to consume the period-data-updated event, with `WITH_KAFKA_BROKERS=false` in env, docker-compose and test setup

## 2. Database

- [ ] 2.1 This service's own Postgres on `agiliz_network`
- [ ] 2.2 Prisma schema: derived stock per store, SKU and period boundary, plus configurable minimum levels per store and SKU
- [ ] 2.3 Persist derived values as a materialised read model keyed by period, so point-in-time reads do not re-sum all history on every request
- [ ] 2.4 Unique constraints enforcing one derived row per (store, SKU, period) and one minimum per (store, SKU)
- [ ] 2.5 Initial migration owned solely by this service; repositories on `PrismaRepository<T, Model>`

## 3. Derivation

- [ ] 3.1 Read restocked and removed quantities from `supply-service` and sold quantities from `sales-service`, via `@app/http-client`
- [ ] 3.2 Derive stock as restocked minus sold minus removed, counting every removal reason regardless of its loss classification
- [ ] 3.3 Implement point-in-time derivation using only movements up to the requested period end
- [ ] 3.4 Guarantee a past closing figure does not change when later periods gain movements
- [ ] 3.5 Refuse any direct stock modification, directing callers to correct the movement records
- [ ] 3.6 Distinguish "no movements known" from a derived stock of zero — never report zero for the former

## 4. Negative stock

- [ ] 4.1 Report negative derived stock rather than clamping it to zero
- [ ] 4.2 Flag negative values as an inconsistency requiring attention
- [ ] 4.3 Make aggregates disclose when they contain negative components, so a total cannot be mistaken for a clean one

## 5. Recomputation

- [ ] 5.1 Implement a `HoldItWorkerHost` consuming the period-data-updated event from `supply-service`
- [ ] 5.2 Make recomputation idempotent — the event is delivered at least once, so a repeat must produce identical values
- [ ] 5.3 Scope recomputation to the affected store and its subsequent periods, leaving other stores untouched
- [ ] 5.4 Recompute later periods too when an earlier period changes, since closing stock carries forward
- [ ] 5.5 Import the event payload shape from the shared contracts location rather than restating it

## 6. Minimum levels

- [ ] 6.1 Implement configurable minimums per store and SKU, replacing the panel mock's hardcoded category rule
- [ ] 6.2 Report below-minimum status only for SKUs that actually have a configured minimum
- [ ] 6.3 Implement a below-minimum listing per store

## 7. HTTP surface

- [ ] 7.1 Read endpoints for a store's stock, a single store-and-SKU stock, point-in-time stock, and the below-minimum listing
- [ ] 7.2 Endpoints to configure minimum levels
- [ ] 7.3 Apply a deterministic sort so repeated identical listings return a stable order
- [ ] 7.4 Generate the OpenAPI/Swagger document
- [ ] 7.5 Use the glossary terms from `openspec/project.md` (Remaining stock, Store, SKU, Restock)

## 8. Tests

- [ ] 8.1 Derivation fixture: 100 restocked, 60 sold, 5 removed yields 35
- [ ] 8.2 Non-loss removals still reduce stock — loss classification must not affect the quantity
- [ ] 8.3 Point-in-time: end-of-March figure excludes April, and stays unchanged after April movements are added
- [ ] 8.4 Negative stock is reported and flagged, never clamped
- [ ] 8.5 Recomputation is idempotent and scoped to the affected store
- [ ] 8.6 An earlier period changing recomputes later periods too
- [ ] 8.7 "No movements" is distinguishable from zero stock
- [ ] 8.8 Worker integration test against a real Redis, following `@app/hold-it`'s own integration-spec pattern
- [ ] 8.9 Integration tests against a real Postgres covering every scenario in the `inventory` spec

## 9. Docker and CLI

- [ ] 9.1 Multi-stage Dockerfile with a repo-root build context; start via `node -r ./register-paths.js`
- [ ] 9.2 `docker-compose.yml` on `agiliz_network` with a `127.0.0.1` healthcheck and no published host port
- [ ] 9.3 Register `inventory` in `cli/agiliz-cli` after the services it reads; update `--help` and completion candidates

## 10. Documentation

- [ ] 10.1 Write `backend/apps/inventory-service/CLAUDE.md`, stating that stock is derived and never entered, and why negative values are surfaced
- [ ] 10.2 List the service in `backend/CLAUDE.md` and `cli/CLAUDE.md`

## 11. Verification

- [ ] 11.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [ ] 11.2 `agiliz-cli up` brings the stack up healthy
- [ ] 11.3 Ingest a period, confirm derived stock matches a hand-calculation, re-ingest and confirm it is unchanged
- [ ] 11.4 `openspec validate add-inventory-service --strict` passes

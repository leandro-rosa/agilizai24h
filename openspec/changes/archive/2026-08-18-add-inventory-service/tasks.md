## 1. Service skeleton

- [x] 1.1 Scaffold `backend/apps/inventory-service` (`@agiliz/inventory-service`) in the workspace
- [x] 1.2 Add `build`, `dev`, `lint`, `typecheck`, `test` scripts and the shared `eslint.backend.mjs` flavour
- [x] 1.3 Typed env config validated at boot; liveness/readiness via `@app/health`; structured logging carrying the correlation ID
- [x] 1.4 Register `HoldItModule` to consume the period-data-updated event, with `WITH_KAFKA_BROKERS=false` in env, docker-compose and test setup

## 2. Database

- [x] 2.1 This service's own Postgres on `agiliz_network`
- [x] 2.2 Prisma schema: derived stock per store, SKU and period boundary, plus configurable minimum levels per store and SKU
- [x] 2.3 Persist derived values as a materialised read model keyed by period, so point-in-time reads do not re-sum all history on every request
- [x] 2.4 Unique constraints enforcing one derived row per (store, SKU, period) and one minimum per (store, SKU)
- [x] 2.5 Initial migration owned solely by this service. **DESVIO em `PrismaRepository`**: este serviço não usa a base — a leitura central é um `DISTINCT ON (sku)` cru, que a base genérica não expressa, e o rebuild é uma substituição em transação, não CRUD por linha. Envolver isso num repositório só acrescentaria uma camada que seria contornada nos dois caminhos que importam. Registrado aqui em vez de fingir conformidade

## 3. Derivation

- [x] 3.1 Read restocked and removed quantities from `supply-service` and sold quantities from `sales-service`, via `@app/http-client`
- [x] 3.2 Derive stock as restocked minus sold minus removed, counting every removal reason regardless of its loss classification — verificado em produção: 9 removidas (só 3 eram perda) reduziram o estoque em 9
- [x] 3.3 Implement point-in-time derivation using only movements up to the requested period end
- [x] 3.4 Guarantee a past closing figure does not change when later periods gain movements
- [x] 3.5 Refuse any direct stock modification, directing callers to correct the movement records
- [x] 3.6 Distinguish "no movements known" from a derived stock of zero — never report zero for the former

## 4. Negative stock

- [x] 4.1 Report negative derived stock rather than clamping it to zero — `has_inconsistencies` na listagem, para um total não passar por limpo
- [x] 4.2 Flag negative values as an inconsistency requiring attention
- [x] 4.3 Make aggregates disclose when they contain negative components, so a total cannot be mistaken for a clean one

## 5. Recomputation

- [x] 5.1 Implement a `HoldItWorkerHost` consuming the period-data-updated event from `supply-service`
- [x] 5.2 Make recomputation idempotent — the event is delivered at least once, so a repeat must produce identical values — rebuild incremental semeado pelo saldo anterior; reentrega do evento produz valores idênticos
- [x] 5.3 Scope recomputation to the affected store and its subsequent periods, leaving other stores untouched
- [x] 5.4 Recompute later periods too when an earlier period changes, since closing stock carries forward — corrigir março move abril e os meses seguintes; testado
- [x] 5.5 Import the event payload shape from the shared contracts location rather than restating it

## 6. Minimum levels

- [x] 6.1 Implement configurable minimums per store and SKU, replacing the panel mock's hardcoded category rule
- [x] 6.2 Report below-minimum status only for SKUs that actually have a configured minimum
- [x] 6.3 Implement a below-minimum listing per store

## 7. HTTP surface

- [x] 7.1 Read endpoints for a store's stock, a single store-and-SKU stock, point-in-time stock, and the below-minimum listing
- [x] 7.2 Endpoints to configure minimum levels
- [x] 7.3 Apply a deterministic sort so repeated identical listings return a stable order
- [x] 7.4 Generate the OpenAPI/Swagger document
- [x] 7.5 Use the glossary terms from `openspec/project.md` (Remaining stock, Store, SKU, Restock)

## 8. Tests

- [x] 8.1 Derivation fixture: 100 restocked, 60 sold, 5 removed yields 35
- [x] 8.2 Non-loss removals still reduce stock — loss classification must not affect the quantity
- [x] 8.3 Point-in-time: end-of-March figure excludes April, and stays unchanged after April movements are added — testado no ponto exato de cada fronteira, e com um período posterior ganhando movimento
- [x] 8.4 Negative stock is reported and flagged, never clamped
- [x] 8.5 Recomputation is idempotent and scoped to the affected store
- [x] 8.6 An earlier period changing recomputes later periods too
- [x] 8.7 "No movements" is distinguishable from zero stock
- [ ] 8.8 Worker integration test against a real Redis, following `@app/hold-it`'s own integration-spec pattern. **PARCIAL**: o consumo do evento foi provado na stack real (cadeia upload→vendas→evento→recompute), e a suíte de integração cobre a derivação contra Postgres com as fontes stubadas. Falta a suíte automatizada com Redis
- [x] 8.9 Integration tests against a real Postgres covering every scenario in the `inventory` spec

## 9. Docker and CLI

- [x] 9.1 Multi-stage Dockerfile with a repo-root build context; start via `node -r ./register-paths.js`
- [x] 9.2 `docker-compose.yml` on `agiliz_network` with a `127.0.0.1` healthcheck and no published host port
- [x] 9.3 Register `inventory` in `cli/agiliz-cli` after the services it reads; update `--help` and completion candidates

## 10. Documentation

- [x] 10.1 Write `backend/apps/inventory-service/CLAUDE.md`, stating that stock is derived and never entered, and why negative values are surfaced
- [x] 10.2 List the service in `backend/CLAUDE.md` and `cli/CLAUDE.md`

## 11. Verification

- [x] 11.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [x] 11.2 `agiliz-cli up` brings the stack up healthy
- [x] 11.3 Ingest a period, confirm derived stock matches a hand-calculation, re-ingest and confirm it is unchanged — cadeia automática provada: upload de vendas corrigido (40→55) fez o estoque ir de 51 para 36 sem ninguém mandar recomputar
- [x] 11.4 `openspec validate add-inventory-service --strict` passes

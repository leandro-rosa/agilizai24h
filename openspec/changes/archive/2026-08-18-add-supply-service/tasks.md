## 1. Service skeleton

- [x] 1.1 Scaffold `backend/apps/supply-service` (`@agiliz/supply-service`) in the workspace
- [x] 1.2 Add `build`, `dev`, `lint`, `typecheck`, `test` scripts and the shared `eslint.backend.mjs` flavour
- [x] 1.3 Typed env config validated at boot; liveness/readiness via `@app/health`; structured logging carrying the inbound correlation ID
- [x] 1.4 Register `HoldItModule` for both the consumed ingestion queue and the published event, and set `WITH_KAFKA_BROKERS=false` in env, docker-compose and test setup

## 2. Database

- [x] 2.1 This service's own Postgres on `agiliz_network`
- [x] 2.2 Prisma schema: removal reasons (with `countsAsLoss`), restock records (store, period, SKU, quantity), removal records (store, period, SKU, reason, quantity), and an ingestion reference
- [x] 2.3 Seed the six reasons and their classifications in the initial migration — expired, damaged product, other reason count as loss; return, transfer, internal use do not (design D1, "Migration Plan") — seed gerado a partir de `removal-reasons.ts`, para constante e banco não divergirem
- [x] 2.4 Unique constraints enforcing the grains: (store, period, SKU) for restocks and (store, period, SKU, reason) for removals
- [x] 2.5 Index the (store, period) read path used by every consumer
- [x] 2.6 Keep the original removal line's raw text as an audit-only field, explicitly not a quantity anything computes from (design D3)
- [x] 2.7 Initial migration owned solely by this service; repositories on `PrismaRepository<T, Model>`

## 3. Classification

- [x] 3.1 Model reasons as data with an explicit `countsAsLoss` flag — never an enum in code or a hard-coded list in a query (design D1)
- [x] 3.2 Expose the reason set and its classifications as a readable resource, so a displayed figure can show the rule that produced it
- [x] 3.3 Reject removals carrying an unrecognised reason, naming the store, period, SKU and the unrecognised text; never default it into either bucket (design D2) — verificado em runtime: motivo "roubo" falhou o job nomeando o motivo, sem escrever nada

## 4. Records and derivation

- [x] 4.1 Accept removals as already-split per-reason quantities — this service never parses free text
- [ ] 4.2 Validate that a submitted split's per-reason quantities sum to the reported total, rejecting mismatches. **NÃO SE APLICA AQUI**: este serviço nunca vê um total reportado — `SupplyRemovalRow` carrega só quantidades por motivo, porque quem interpreta a linha original é o parser. A validação existe, mas pertence a `add-ingestion-flow` (tarefa 4.4 de lá), que tem o texto e o total. Deixar aqui seria inventar um campo só para validá-lo
- [x] 4.3 Store restocks and removals separately, never netting one into the other
- [x] 4.4 Derive real loss on read as the sum over loss-counting reasons — do not store a loss column (design D4) — pura e testada isoladamente (7 testes), mais 20 de integração contra o banco
- [x] 4.5 Expose real loss in total, by reason, and by SKU, and confirm the breakdowns sum to the total

## 5. Ingestion writes

- [x] 5.1 Implement a `HoldItWorkerHost` consumer for parsed supply rows from `ingestion-worker-service`
- [x] 5.2 Replace a store's period wholesale in a single transaction, matching `sales-service`'s contract (design D7)
- [x] 5.3 Leave other periods and other stores untouched
- [x] 5.4 Record the originating ingestion reference, updating it on replacement
- [x] 5.5 Carry the correlation ID from the job payload into this service's logs

## 6. Period data updated event

- [x] 6.1 Publish the event with store and period identifiers only — no monetary figures, no computed totals (design D5)
- [x] 6.2 Publish only after the replacement transaction commits, so no consumer can read a half-replaced period
- [x] 6.3 Suppress the event when an ingestion changed nothing, comparing against stored state first (design D6) — verificado em runtime: reenfileirar job idêntico manteve a fila de eventos em 1
- [x] 6.4 Define the event payload in the shared contracts location, scoped by event family, so `finance-service` imports it rather than restating it

## 7. HTTP surface

- [x] 7.1 Read endpoints for a store's period: restocks per SKU, removals per SKU and reason each marked with its loss classification, and derived loss
- [x] 7.2 Distinguish "period never ingested" from "period with no restocks or removals" — never return zeroes for the former
- [x] 7.3 Generate the OpenAPI/Swagger document
- [x] 7.4 Use the glossary terms from `openspec/project.md` (Restock, Removals, Reason, Real loss, Expired, Damaged product, Other reason, Return, Transfer, Internal use)

## 8. Tests

- [x] 8.1 **Mixed-reason fixture**: a removal of 9 units recorded as 6 return and 3 other reason yields exactly 3 units of real loss, stored as two records with no combined row (the spec's defining case) — verde em unitário, integração e em container: 9 removidas → 3 de perda
- [x] 8.2 Single-reason removal fixture
- [x] 8.3 Non-loss-only period yields zero real loss while still reporting the removals
- [x] 8.4 Unrecognised reason is rejected and reported, never silently bucketed
- [x] 8.5 Split quantities that do not sum to the reported total are rejected
- [x] 8.6 Breakdowns by reason and by SKU each sum to the reported total
- [x] 8.7 Idempotency tests mirroring `sales-service`: identical re-ingestion changes nothing; corrected data replaces; dropped SKUs disappear; other periods untouched
- [x] 8.8 Event tests: published after commit, suppressed when nothing changed, carries no monetary figures
- [ ] 8.9 Worker integration test against a real Redis, following `@app/hold-it`'s own integration-spec pattern. **PARCIAL**: o caminho da fila foi exercitado à mão contra Redis real (job → worker → persistência → evento publicado, e supressão em reenvio idêntico), e a decisão publicar/suprimir tem 7 testes unitários. Falta a suíte `*.integration-spec.ts` automatizada — mesmo débito de `sales` e `gateway`
- [x] 8.10 Integration tests against a real Postgres covering every scenario in the `supply` spec

## 9. Docker and CLI

- [x] 9.1 Multi-stage Dockerfile with a repo-root build context; start via `node -r ./register-paths.js`
- [x] 9.2 `docker-compose.yml` on `agiliz_network` with a `127.0.0.1` healthcheck and no published host port
- [x] 9.3 Register `supply` in `cli/agiliz-cli` after `infra`, updating `--help` and completion candidates

## 10. Documentation

- [x] 10.1 Write `backend/apps/supply-service/CLAUDE.md`, stating the loss rule, the per-reason storage contract, and that this service never parses free text
- [x] 10.2 Record the retroactive-restatement risk of editing `countsAsLoss` (design "Risks") so it is not treated as ordinary configuration
- [x] 10.3 List the service in `backend/CLAUDE.md` and `cli/CLAUDE.md`

## 11. Verification

- [x] 11.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [x] 11.2 `agiliz-cli up -i infra -i supply` brings the service up healthy
- [x] 11.3 Ingest a period containing a mixed-reason removal and confirm the derived loss matches a hand-calculation — pela fila real, no container: `-6 Devolução, -3 Outro motivo` rendeu total 3
- [x] 11.4 `openspec validate add-supply-service --strict` passes

## 1. Service skeleton

- [ ] 1.1 Scaffold `backend/apps/finance-service` (`@agiliz/finance-service`) in the workspace
- [ ] 1.2 Add `build`, `dev`, `lint`, `typecheck`, `test` scripts and the shared `eslint.backend.mjs` flavour
- [ ] 1.3 Typed env config validated at boot; liveness/readiness via `@app/health`; structured logging carrying the correlation ID
- [ ] 1.4 Register `HoldItModule` to consume the period-data-updated event, with `WITH_KAFKA_BROKERS=false` in env, docker-compose and test setup

## 2. Database

- [ ] 2.1 This service's own Postgres on `agiliz_network`
- [ ] 2.2 Prisma schema: materialised reconciliation per store and month — the four figures, the valuation date used, completeness status, and the unresolved-SKU list
- [ ] 2.3 Per-reason and per-product loss breakdowns stored alongside, in units and currency
- [ ] 2.4 Store all money as integer minor units — no floats anywhere (design D5)
- [ ] 2.5 Record an inputs-last-changed marker so a stale result is detectable (design "Risks")
- [ ] 2.6 Unique constraint on (store, month); initial migration owned solely by this service; repositories on `PrismaRepository<T, Model>`

## 3. Upstream clients

- [ ] 3.1 Typed clients on `@app/http-client` for `supply-service`, `sales-service`, `inventory-service` and `products-service`
- [ ] 3.2 Consume `products-service`'s partitioned cost result directly — never flatten it into a map, which reintroduces the `?? 0` failure (design D3)
- [ ] 3.3 Consume `supply-service`'s per-reason quantities with their loss flags; do not carry a local list of which reasons count (design D4)
- [ ] 3.4 Treat "no data" responses from upstream as absence, never as zero

## 4. Computation

- [ ] 4.1 Resolve costs as of the last day of the month being reconciled, and record that date on the result (design D1)
- [ ] 4.2 Compute restocked value as restocked quantity × cost, per SKU, summed
- [ ] 4.3 Compute cost of goods sold as sold quantity × cost, per SKU, summed
- [ ] 4.4 Compute remaining stock value from `inventory-service` quantities × cost
- [ ] 4.5 Compute real loss from loss-flagged removal quantities × cost only
- [ ] 4.6 Produce loss breakdowns by reason and by product, in units and currency, and assert they sum to the total
- [ ] 4.7 Perform all arithmetic in integer minor units; round only at presentation, and state the rule where rounding occurs

## 5. Completeness

- [ ] 5.1 Mark a reconciliation incomplete when any SKU could not be priced or matched
- [ ] 5.2 List every unresolved SKU with its quantity and the reason it could not be valued
- [ ] 5.3 Guarantee an unpriced SKU contributes nothing to any total and is never valued at zero (design D3)
- [ ] 5.4 Propagate incompleteness to network rollups, so an aggregate containing an incomplete store is itself incomplete
- [ ] 5.5 Make a fully complete reconciliation explicitly distinguishable

## 6. Recomputation

- [ ] 6.1 Implement a `HoldItWorkerHost` consuming the period-data-updated event, importing its payload shape from the shared contracts location
- [ ] 6.2 Replace a store-month's stored figures wholesale in one transaction, matching the pattern used by `sales-service` and `supply-service` (design D7)
- [ ] 6.3 Guarantee idempotency — the event is delivered at least once, so repeats must produce identical figures
- [ ] 6.4 Scope recomputation to the affected store and month, leaving others untouched
- [ ] 6.5 Expose a manual recompute for backfills and cost corrections, which produce no supply event (design D6)

## 7. HTTP surface

- [ ] 7.1 Read endpoints: one store's month, a network rollup for a month, and a multi-month series for one store
- [ ] 7.2 Return the completeness statement on every response, including rollups
- [ ] 7.3 State the money unit explicitly on every monetary field in the OpenAPI document
- [ ] 7.4 Use the glossary terms from `openspec/project.md` (COGS, Real loss, Remaining stock, Restocked, Reason)

## 8. Tests

- [ ] 8.1 **Historical stability**: reconcile a month, record a later higher cost, recompute, assert figures unchanged (design "Risks" — the test that catches a wrong valuation date)
- [ ] 8.2 Valuation uses the month's own cost, not the latest, with costs on both sides of the month
- [ ] 8.3 **Mixed-reason loss**: a month with 6 returned and 3 other-reason units values only the 3 as loss
- [ ] 8.4 Non-loss-only month yields zero real loss while restocked value and COGS are still computed
- [ ] 8.5 **Unpriced SKU**: reconciliation is incomplete, the SKU is listed, and it contributes no zero-valued line
- [ ] 8.6 Incompleteness propagates to a network rollup
- [ ] 8.7 Loss breakdowns by reason and by product each sum to the total
- [ ] 8.8 Exact-arithmetic test: many per-SKU values sum with no drift
- [ ] 8.9 Recomputation is idempotent and scoped
- [ ] 8.10 "No data for this month" is distinguishable from a month of zeroes
- [ ] 8.11 Worker integration test against a real Redis, following `@app/hold-it`'s own integration-spec pattern
- [ ] 8.12 Integration tests against a real Postgres covering every scenario in the `reconciliation` spec
- [ ] 8.13 **End-to-end test**: upload the three files → parse → reconcile → read the figures through the gateway

## 9. Docker and CLI

- [ ] 9.1 Multi-stage Dockerfile with a repo-root build context; start via `node -r ./register-paths.js`
- [ ] 9.2 `docker-compose.yml` on `agiliz_network` with a `127.0.0.1` healthcheck and no published host port
- [ ] 9.3 Register `finance` in `cli/agiliz-cli` after the services it reads; update `--help` and completion candidates

## 10. Documentation

- [ ] 10.1 Write `backend/apps/finance-service/CLAUDE.md`: the four figures, the valuation-date rule, the completeness contract, and that the loss rule lives in `supply-service`
- [ ] 10.2 List the service in `backend/CLAUDE.md` and `cli/CLAUDE.md`

## 11. Verification

- [ ] 11.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [ ] 11.2 `agiliz-cli up` brings the full stack up healthy
- [ ] 11.3 **Acceptance bar**: reconcile a month the operators have already closed by hand and confirm every figure matches their spreadsheet — this, not passing tests, is what makes the change done (design "Migration Plan")
- [ ] 11.4 Confirm the valuation date used is recorded on the stored result
- [ ] 11.5 `openspec validate add-finance-service --strict` passes

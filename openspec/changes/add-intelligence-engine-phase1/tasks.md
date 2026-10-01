## 1. Preparation

- [x] 1.1 Work in an isolated worktree; check the target checkout's `git status` before any merge and never stage unrelated files. Run jest with `--maxWorkers=2` and turbo with `--concurrency=1` (the owner asked not to overload the machine).
- [x] 1.2 Record the baseline of lint, typecheck and tests for the packages this change touches, so a new failure is attributable.
- [x] 1.3 Save a read-only extract of real history for tests and backtest development outside the repo (visits, monthly sales, monthly removals, cost) and note its control sums; never copy it into a real database.

## 2. Service scaffold

- [x] 2.1 Scaffold `backend/apps/intelligence-service` following the repo's microservice skill: Fastify bootstrap, Prisma + adapter-pg, `DbClientModule`, env validation (`WITH_KAFKA_BROKERS`, service URLs, queue host), health, correlation-id middleware, per-module `CLAUDE.md`.
- [x] 2.2 Dockerfile (dev and runtime, `prisma:deploy` in the CMD), `docker-compose.yml` with its own Postgres (host port 5446) on `agiliz_network`, entries in `.env.example`, and the project registry of `cli/agiliz-cli` (maps, up and down order) with its tests.
- [x] 2.3 Add the service to `backend/CLAUDE.md` and the root `CLAUDE.md` index; register the HTTP clients for `supply-service`, `sales-service` and `products-service`.

## 3. Data model

- [x] 3.1 Prisma schema and migration: `parameter_version`, `baseline_quantity` (append-only), `store_schedule`, `product_store_flag`, `engine_run`, `recommendation`, `backtest_run`, `backtest_result`.
- [x] 3.2 Repository tests on an isolated Postgres: append-only history, current baseline resolution, latest parameter version.

## 4. Parameters

- [x] 4.1 Parameter schema with the defaults of the design (tolerance 10% or 3 units, windowCounts, minCounts, maxAgeDays, half-life, censoring shares, pattern thresholds, mix and alert parameters, `L`, `z`, visit weekdays), validation that rejects nonsense (inverted bands, negative values), and every default labelled provisional.
- [x] 4.2 Internal routes to read the current and any historical parameter version and to create a new one; creating never edits an earlier version; initial version created at first start.
- [x] 4.3 Tests: new version leaves the old readable, invalid document rejected, defaults equal the owner's 10% / 3 units, default visit weekdays Monday, Tuesday, Thursday, Friday and a per-store override.

## 5. Baseline and packaging import

- [x] 5.1 Import route and parser for pricing-sheet rows (`SKU`, `qtd itens por loja`, `Medida`): tolerate `#ERROR!` rows, record baselines append-only with source and date, report rows rejected with reason.
- [x] 5.2 Conflicting duplicate SKUs (for example 6024, 9987 in the real sheet) are rejected and reported, never resolved by picking one.
- [x] 5.3 Write `Medida` to the product's `packageType` through `products-service`; leave units per package unknown.
- [x] 5.4 Tests with a fixture shaped like the real sheet, including the error rows and the conflicting duplicates; a re-import with a changed value keeps both values in history.
- [x] 5.5 Import the real pricing sheet from the owner's Drive file into the real service once, after review of the rejection report with the owner.

## 6. Engine, pure functions

- [x] 6.1 Intervals and cycles from visits (D3): censoring, negative-consumption exclusion, short-interval merge, removals of every reason reducing the balance; tests including the plan's Trident Menta × Ascenty ADM sequence expressed as a fixture.
- [x] 6.2 Demand rates (D4): recency-weighted p25/p50/p80 from uncensored intervals, censoring flag and raised upper rate; tests that recency matters and that a plain mean is not used.
- [x] 6.3 Pattern (D5): the three example series classify as stable, declining, volatile; new and insufficient cases.
- [x] 6.4 Replenishment interval and quantity band (D6): Quantity decision with the assumed `H`, no rounding to package multiples, no claim of missing stock without censoring or growth.
- [x] 6.5 Mix and presence states (D7), contribution after losses counted once, network-level evaluation requiring the majority of exposed stores; never-tested is never low adherence; new products not penalised; loss alone never removes or reduces.
- [x] 6.6 Operational alerts (D8) as facts; "other reason" never inferred as theft; splitting and capacity alerts off with a stated reason.
- [x] 6.7 Estimated balance, anchor and tolerance status (D9): the 10%/3-unit rule including the "1 or 2 units never block" and "both limits exceeded" cases, `within_tolerance` / `outside_tolerance` / `not_verifiable` with reasons, the gate flag, and the label "estimated balance".
- [x] 6.8a Conflicting-data flag (balance rise without event, consumption with no imported sales, rejected SKU, conflicting baseline): lists the conflicts and blocks the balance gate regardless of tolerance status; tests for each conflict and for "within tolerance but conflicting".
- [x] 6.8 Confidence (D10): three separate values with reasons and caps that only lower; a high recommendation confidence with low balance reliability is valid.
- [x] 6.9 Result assembly: facts, evidence to keep, evidence to change, limitations; engine version constant; determinism test (same input, same output); test that running the engine writes nothing outside its own results.
- [x] 6.10 Cases from the 12 real examples of the plan as fixtures (healthy, excess, growth, low adherence, recurring expiry with falling demand, good sales plus "other reason", never tested, good history without recent restock, reliable balance, unreliable balance).

## 7. Runs and results

- [x] 7.1 Source readers: visits per store from `supply-service`, period removals by reason, monthly sales, cost; a failing store is reported as skipped with the reason, never as zero; synthetic stores and SKUs skipped and listed.
- [x] 7.2 `POST /runs` creating an `engine_run` with versions, as-of date and `dataThrough`, one queue job per store, a worker that computes and persists results, and run status endpoints.
- [x] 7.3 Results read routes by run, store and SKU, with the stored parameter version available.
- [x] 7.4 Integration test on an isolated Postgres with the broker stubbed: a run persists a result per Product × Store, records both versions, survives one failing store, and is idempotent for the same inputs.

## 8. Backtest

- [x] 8.1 Data view that returns only records ending before an origin; a test asserting no later date is ever read.
- [x] 8.2 Rolling-origin replay (April to August 2026 origins) recording, per Product × Store with enough data: baseline in force (with the "baseline of the time unknown" marker where it applies), recommended quantity, `H`, action and Mix state, and afterwards sales, losses by reason, stock-outs and economic result (loss counted once).
- [x] 8.3 Demand-forecast error as one metric (censored actuals counted apart and excluded).
- [x] 8.4 Coherence assessment per action (reduce, increase/test, keep, evaluate removal) with the criteria shown, labelled an estimate and worded as "compatible with the data that followed", never as correct or proven; for reductions show separately the losses and sales that followed, the cycles in which demand exceeded the recommended quantity, the potentially avoidable loss units and the units of sales at risk; conflicting criteria → inconclusive. Tests: reduction compatible with the data, reduction with mixed evidence (inconclusive), harmful reduction, unsupported increase, too little afterwards, and that no output wording claims correctness.
- [x] 8.5 Coverage report with the five exclusive categories summing to the total; tests that conflicting data wins over balance status and that each pair appears once.
- [x] 8.6 Count-rule sensitivity report over the grid of counts considered, minimum counts, maximum age and tolerance, with the configured defaults marked; it selects nothing; test that the defaults appear in the grid.
- [x] 8.7 Stored report with per-pair results, aggregates, coverage and sensitivity tables, every figure with its coverage (origins, pairs, cycles) and no verdict or frozen threshold; test that no key reads like pass/fail and that "coherent" is not worded as approval.
- [x] 8.8 A readable summary of the stored report: `GET /backtests/:id/summary` (plain text) and `GET /backtests/:id` (JSON), `GET /backtests` list, `POST /backtests` to start one through the queue; internal, no gateway route.

## 9. Monthly refresh

- [ ] 9.1 Month availability (calendar month ended, supply and sales both imported for at least the parameterised share of active stores), `dataThrough`, `pendingImport`; tests including a partially imported month.
- [ ] 9.2 Subscribe to `period.data-updated` events of supply and sales, and a manual trigger; when `dataThrough` advances enqueue one refresh that runs engine, coverage, backtest (origins extended to the new month) and sensitivity as a linked, immutable set; a failed refresh leaves the previous current set in place.
- [ ] 9.3 History: sets are never overwritten, each stamped with the period covered, engine version, parameter version and computation time; a "current" pointer moves only when the whole set has finished; read a Product × Store's evolution across sets. Test: the September set does not alter or delete the August set.
- [ ] 9.4 Freshness on every result and report (`dataThrough`, `computedAt`) and `outOfDate` by number of months lagged when a later month is available; tests for up to date, a closed month not yet incorporated and a month not yet imported (never claimed as covered).
- [x] 9.5 Add to the Phase 2 requirements (in `docs/commercial-intelligence-v2-design.md`) that every screen shows "Dados atualizados até <month>", "Última atualização da inteligência <date>" and the out-of-date mark.

## 10. Verification and closing

- [ ] 10.1 Run the engine against real January to August history and sanity-check against the 12 plan examples; explain any difference.
- [ ] 10.2 Run the backtest on the real history; read the report, list what it shows about the provisional defaults, and prepare it for review with the owner. Do not freeze any threshold.
- [ ] 10.3 Present the coverage report (analysable, reliable, unreliable, not enough counts, conflicting data, insufficient history) and the count-rule sensitivity report on real history to the owner; keep 3 counts / minimum 1 / 45 days as provisional and choose no combination until the owner has chosen after seeing the sensitivity report.
- [ ] 10.4 Lint, typecheck and tests for the affected packages compared with the baseline; update `intelligence-service/CLAUDE.md`, the root index and the memory notes.
- [ ] 10.5 Commit and merge to the main branch in the same session after checking the target checkout's `git status`, without staging unrelated files.

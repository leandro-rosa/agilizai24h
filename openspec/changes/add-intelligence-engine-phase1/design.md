## Context

Phase 0 (`add-stock-quality-phase0`) stores every supply visit and line (`supply_visit`, `supply_visit_line`) and measures balance quality. Measured on January to August 2026: 88,199 visit lines, 29% with a count, 97.0% of counts equal to the system balance; consumption between visits matches registered sales by store-month (median ratio 0.985). `Qtd. confirmada` is the count made before restocking (`Diferença = confirmada − anterior`); the balance after a visit is `Qtd. final`. Capacity is empty everywhere. Visits happen on Monday, Tuesday, Thursday and Friday with sporadic changes. Sales exist only as monthly aggregates per store and SKU; removals by reason are monthly; visit lines carry only the removed total. Cost is the current cost per SKU (one version). The approved plan is `docs/commercial-intelligence-v2-design.md`; this design implements its Phase 1.

Constraints from the repo: NestJS microservices with a database each (Prisma + adapter-pg), non-trivial processing through BullMQ (`@app/hold-it`), `WITH_KAFKA_BROKERS=false`, English code and artifacts, Portuguese UI only. Rules that shape recommendations live in the backend, never the browser. No synthetic data in real databases.

## Goals / Non-Goals

**Goals:**
- A pure, deterministic engine (same data + engine version + parameter version → same result) producing the contract of plan section B for every Product × Store.
- Parameters, tolerance and baseline in backend configuration with append-only history.
- A backtest that can be read before any screen exists.

**Non-Goals:**
- "How much to bring" and next-visit dates (Phase 4), any screen, gateway route, drawer or matrix (Phases 2 and 3), the decision log (Phase 5), similar-store opportunity, box-splitting optimisation.
- Freezing any threshold. All defaults below are provisional starting values for the backtest to question.
- Changing `supply`, `sales`, `products` or `inventory` behavior.

## Decisions

### D1. A new `intelligence-service`, reading and never writing the others

Own Postgres (host port 5446), Fastify bootstrap, Prisma + adapter-pg, module layout and per-module `CLAUDE.md` as in the repo skill. It reads `supply-service` (visits, period removals by reason), `sales-service` (monthly sales) and `products-service` (cost, packaging) over HTTP with `@app/http-client`. Every call from the engine and the source clients is a read; **the only write to another service is the owner-triggered packaging import of D12** (`PATCH /products/:id` with the packaging type), isolated in one writer class that nothing in the engine imports, and guarded by a test that fails if any other file writes. Alternatives: a module inside `supply-service` (rejected — mixes a decision engine with the owner of movement facts, and the owner chose a separate service); computing in the browser (rejected — rules live in the backend).

### D2. Runs are queued and persisted

`POST /runs` records an `engine_run` (status, engine version, parameter version, as-of date, range, data-through date) and enqueues one job per store; the worker computes each store and persists results; `GET /runs/:id` and `GET /runs/:id/results?storeId=&sku=` read them. Results store the full result JSON plus indexed columns for Mix, Quantity action, tolerance status and store/SKU. Alternative: compute on every read like the Phase 0 audit (rejected — the engine is heavier, results are versioned and need to be compared across runs and backtested).

### D3. Intervals first, cycles on top

For each store and SKU the visit lines are ordered by visit end. An **interval** is the stretch between two consecutive appearances of the SKU: `consumption = balanceAfter(k) − balanceBefore(k+1)` and `days` is the elapsed time. An interval is **censored** when `balanceBefore(k+1) = 0` (the shelf emptied; consumption is a lower bound). A negative consumption (balance rose with no event) is excluded and counted as a data warning. A **cycle** groups intervals from one restocking to the next and reports starting balance, restocked quantity, removals by visit, consumption, days and whether any interval was censored. Intervals shorter than a parameter minimum (default 1 day) are merged into the neighbour to avoid rate blow-ups. The same rule is used by the Phase 0 audit, so figures reconcile.

### D4. Demand: recency-weighted rates, censoring handled explicitly

From the uncensored intervals the engine takes the daily rates `consumption / days`, weights them by days and by recency (exponential, half-life parameter default 56 days) and reports a weighted p25, p50 and p80. Censored intervals are never demand: if the share of censored intervals in the last cycles exceeds a parameter (default 30%), the result flags `demandCensored` and raises the upper rate to at least the highest censored lower bound, which is what lets a stock-out produce "increase" evidence. A plain mean of monthly sales is never used. Alternatives: Kaplan–Meier or tobit estimation (rejected for Phase 1 — too opaque for a decision that must be explained in two sentences; revisit if the backtest shows censoring bias).

### D5. Pattern is evidence only

Over the last N (default 6) uncensored interval rates: fewer than 3 → `insufficient`; first appearance within the "new" window (default 2 cycles) → `new`; otherwise Kendall's tau of rate against time with |tau| ≥ 0.6 → `growing` or `declining` (sign), else coefficient of variation above 0.5 → `volatile`, else `stable`. The plan's three example series classify as stable, declining and volatile (a test). The pattern is a field of the result; no decision reads it alone.

### D6. Replenishment interval H and the quantity band

`H` is the median days between restock events of the Product × Store over the last 8 events, or the override `planned_refill_interval_days` when set. The band uses lead `L` (default 2 days) and safety `SS = z · σ(rate) · √(H+L)` (z default 1.0): `Q_low = ceil(p50 · (H+L))`, `Q_high = ceil(p80 · (H+L) + SS)`. The result always states the `H` it assumed. Decisions: baseline within `[Q_low, Q_high]` → keep; baseline above `Q_high` with no recent censoring → reduce to `Q_high` (not rounded to any package multiple); recent censoring (share of censored intervals at or above a parameter, default 25%) and baseline below `Q_low` → increase; a growing pattern with low loss share, no censoring and baseline below `Q_low` → test a larger quantity; otherwise → no evidence to change. A loss never reduces quantity by itself: expiry loss only lowers `Q_high` through demand, and an expiry-driven excess is reported as evidence, not as an automatic reduction. When `units_per_package` is known the result adds "requires splitting the box of N"; it is never used to round.

### D7. Mix and presence states

Presence per Product × Store: `sells` (demand at or above the low-demand rate), `low_adherence` (exposed for at least `minExposureCycles`, default 4, and the share of recent uncensored intervals below the low-demand rate — default 1 unit/week — at least a recurrence parameter, default 70%), `restocked_without_sales`, `no_recent_restock` (last restock older than k·H, default k = 3, with a good history), `never_tested` (no visit line with stock and no restock), `insufficient_data`. Mix: `insufficient_data` when too few cycles; `test` for new; `keep` when demand is consistent and contribution after losses is not negative; `evaluate_removal` when exposed long enough, low adherence is recurrent and contribution after losses is low or negative **or** loss is recurrent. Network-level `evaluate_removal` requires the same pattern in more than half of the stores where the SKU was exposed for at least the minimum cycles. Contribution after losses = revenue − cost of units sold − cost of lost units (loss reasons only), computed from monthly figures and the single current cost version; losses are counted once, as lost units, never also netted against sold units. Never-tested is never low adherence.

### D8. Operational alerts are facts

Expiry attention: expired loss in at least 2 of the last 3 months (parameter), shown with a stronger flag when demand is low or declining. Damage investigation: damaged loss in at least 2 of 3 months, with scope local, several stores or network (reuses the Loss Intelligence scoping idea; Loss Intelligence stays an input, not rebuilt). Loss investigation: "other reason" above a share of units restocked (parameter), classification preserved, never labelled theft. Review balance: tolerance status not within tolerance, or non-zero adjustment recurring. Incomplete data: missing sales month, store without visits, SKU rejected at ingestion. These same facts, plus a balance that rose between visits with no event and a conflicting baseline, form the **conflicting-data flag**, which blocks the balance gate whatever the tolerance status says. Splitting and capacity alerts stay off (package size mostly unknown; capacity empty) and say why.

### D9. Estimated balance, anchor and the configurable tolerance gate

Estimated balance = `max(0, balanceAfter(last visit) − p50 · days since that visit)`, labelled estimate. Anchor type is `counted` when the last visit line carried a count, else `system`, and the result also reports the age of the latest count. **Tolerance** per count: `|confirmed − balanceBefore| ≤ max(pct · |balanceBefore|, units)`, defaults 10% and 3 units. **Status per Product × Store** over the last `windowCounts` counts (default 3): `within_tolerance` when at least `minCounts` (default 1) exist, all are acceptable and the latest is no older than `maxAgeDays` (default 45) relative to the run's as-of date; `outside_tolerance` when any counted line in the window exceeds both limits; `not_verifiable` otherwise, with the reason (no counts, too old). The gate flag `releasesBalanceUse` is true only for `within_tolerance`. The last three values are provisional defaults of mine, labelled as such, because the owner specified only the 10% and 3-unit rule; they are parameters. The as-of date of a live run is the run date; because September's reports are not imported yet, a live run reports `dataThrough` and a staleness limitation, and the backtest uses as-of = origin.

### D10. Confidence: three separate values

Recommendation confidence: `high`/`medium`/`low` from the number of uncensored intervals (≥ 8, ≥ 4), exposure, share of missing months and agreement with the network, with caps that only lower it. Balance reliability: from tolerance status, anchor type and age, rate stability and recent censoring. Priority: in R$ — excess units at cost, recurring loss cost, margin at risk — independent of the other two. Each carries its reasons.

### D11. Versioned parameters, baseline and schedule

`parameter_version` rows are append-only JSON documents validated against a schema; the current version is the latest; every result stores `parameterVersionId` and `engineVersion` (a constant bumped with any logic change). `baseline_quantity(sku, quantity, source, effectiveFrom)` is append-only and applies to every store. `store_schedule(storeId, weekdays)` defaults to Monday, Tuesday, Thursday, Friday. `product_store_flag(storeId, sku, preferClosedPack)` is stored and displayed, never read by the math. Parameter writes are internal service routes (no gateway, no screen yet); the owner recalibrates by creating a new version.

### D12. Importing the pricing sheet

An import accepts parsed sheet rows (`SKU`, `qtd itens por loja`, `Medida`), validates them and records baselines. The real sheet has `#ERROR!` rows and repeated SKUs with different packaging (for example 6024, 9987); a SKU with conflicting duplicates is **rejected and reported**, not resolved by picking one. `Medida` maps to the product's `packageType` through `products-service`; the number of units per package is not in the sheet and stays unknown, so splitting alerts remain off. The 14 discontinued products the owner told us to ignore are not required to exist.

### D13. Backtest of the decision process

Origins are the first day of each month from April to August 2026 (at least eight weeks of history). At each origin the engine reads through a data view that returns only records ending before the origin (a test asserts no later date is ever read) and its result is evaluated over the following period (up to the next origin, with the visits and monthly figures that ended in it).

**What is recorded per Product × Store (when it has enough data):** baseline in force, recommended quantity and its `H`, action and Mix state, and afterwards units sold, units lost by reason, cycles observed, stock-outs (censored intervals), and economic result = margin on units sold − cost of lost units (loss reasons only, each lost unit counted once and never netted against sold units; one current cost version, so margin is stated as such). Forecast error is one metric: predicted consumption for the period vs consumption observed between visits, censored observations counted apart and excluded.

**Coherence means only "compatible with the data that followed"**, under criteria shown beside the counts; it is never proof that a recommendation was correct or would have worked (history cannot be replayed under another quantity), every assessment is labelled an estimate, and conflicting evidence is `inconclusive`. Rules (parameters, provisional defaults):
- *Reduce* (baseline `B`, recommended `R`). The report shows **separately** (never as one score): losses that followed by reason; sales that followed; the following cycles in which demand exceeded `R` (cycle consumption > `R`, or censored at `B`); `lossAvoidable = Σ over cycles of min(lossUnits_cycle, B − R)` as an upper bound; `salesAtRisk = Σ over cycles of max(0, cycleConsumption − R)`. Class: coherent when `lossAvoidable > 0` and no cycle exceeded `R` (or `salesAtRisk` is below a small share, parameter, of units sold); incoherent when the loss that followed is zero and demand exceeded `R`; **inconclusive when the criteria point in different directions** (for example loss avoidable and a cycle above `R`) or there are fewer following cycles than the minimum.
- *Increase/test*: compatible when a stock-out or consumption at or above `B` occurred in the following cycles with low loss; incoherent when neither happened and demand fell; inconclusive otherwise or on conflicting criteria.
- *Keep*: compatible without stock-outs and without recurring loss; incoherent with both; inconclusive when only one of them occurred.
- *Evaluate removal*: compatible when demand and economic result stayed low afterwards; incoherent when they recovered; inconclusive otherwise.
Counts of the three classes are descriptive and per action.

**Baseline of the time:** the stored baseline history starts when it was first imported (September 2026), and the inventory `par_level` is a single snapshot (2026-09-24), so no earlier history exists. For every origin the backtest uses the baseline in force according to the history, and where none exists the baseline of record, marking every result that depends on it. Real history of the quantity accumulates from now on because the baseline is append-only.

**Coverage report (also produced by every engine run)** with exclusive categories, evaluated in this order so each Product × Store appears once: insufficient history (too few intervals or cycles, or new within the window) → conflicting data (D8/D9 conflicts: balance rise without event, consumption with no imported sales, SKU rejected at ingestion, conflicting baseline) → analysable, split by tolerance status into reliable balance, unreliable balance and not enough counts. The five numbers sum to the Product × Store considered.

**Count-rule sensitivity:** the same data is recomputed over a grid of counts considered (1, 2, 3, 5), minimum counts (1, 2, 3), maximum age (30, 45, 60, 90 days) and tolerance (5% or 2 units, 10% or 3, 15% or 5), producing the coverage split and the gate-release count for each combination, with the configured defaults marked as one of them. It selects and recommends nothing; the 3 / 1 / 45 defaults stay provisional until the owner has read it. Output is a stored `backtest_run` with per-pair results, aggregates, coverage and sensitivity tables, every figure with its coverage (origins, pairs, cycles). No threshold is frozen and no verdict is produced.

### D14. Monthly refresh, history preserved, freshness stated

**Available month.** A month `M` is *available* when the calendar month has ended and both supply and sales are imported for it for at least a parameterised share (default 90%) of the active stores (stores with visits in the previous three months). `dataThrough` is the latest available month. **Trigger.** The service reacts to the existing `period.data-updated` events of `supply-service` and `sales-service` (and can be started by hand): when `dataThrough` advances it enqueues a **refresh**, which runs, over the history through the new month, the engine, the coverage report, the backtest (origins extended to every month start from April to the new month) and the count-rule sensitivity report, in that order, as one linked set. **History.** Runs and reports are immutable and never overwritten: a refresh creates a new set stamped with the period it covers, the engine version, the parameter version and the computation time; the previous set stays readable, and a "current" pointer moves to the new set only when the whole set has finished. Reading a Product × Store's history returns the sets in order so its evolution can be followed. **Freshness.** Every result and report carries `dataThrough` and `computedAt`; a read compares `dataThrough` with the latest available month and returns `outOfDate` with the number of months it lags, and the service never reports a period it does not cover as covered. A month that has ended but is not yet available is reported as `pendingImport`. Showing "Dados atualizados até" and "Última atualização da inteligência" with the out-of-date mark is a Phase 2 screen requirement; this phase supplies the facts. Alternative: a nightly full recompute regardless of new data (rejected — it would stamp unchanged data as freshly updated); overwriting the previous set (rejected — the evolution of recommendations is part of what the owner wants to follow).

### D15. Synthetic and out-of-scope data

Stores and SKUs flagged synthetic by the convention already used in the admin (test stores, `SKU-*`) are skipped by the engine and reported as skipped. Tests use fixtures shaped like the real reports and an isolated Postgres; nothing synthetic is written to a real database.

## Risks / Trade-offs

- **Only ~29% of lines are counted, so many Product × Store will be `not_verifiable`** and the gate will release little at first → report coverage next to the gate, let the owner recalibrate `windowCounts`, `minCounts` and `maxAgeDays`, and never fill the gap with a guess.
- **September is not imported**, so every count is old for a live run → the run states `dataThrough`; backtest uses origin dates; import September before judging live output.
- **Provisional defaults** (half-life, thresholds, `L`, `z`) are arbitrary → they are parameters, the backtest exists to question them, nothing freezes until read with the owner.
- **Censoring bias** in D4 may understate demand for fast sellers → the backtest reports censored actuals separately; revisit estimators if bias shows.
- **Sales are monthly**, so cycle-level sales are not exact → consumption between visits is the cycle signal; monthly sales are used only for economics and cross-checks, and the Phase 0 audit already shows they agree at store-month level.
- **Consumption and sales share the PDV source** → agreement shows alignment, not physical truth; the limitation is stated on every balance result.
- **Pricing sheet conflicts** → rejected and reported, not guessed.
- **Coherence is an estimate** and the baseline of the time is unknown before September → every coherence figure is labelled an estimate and every result using the baseline of record says so; the report is read with the owner, not used as proof.
- **The count rules may be too strict or too loose** → the sensitivity report shows their real coverage before they are treated as definitive.
- **A month may be imported partially** (some stores late) → availability needs a share of active stores, shown with the figure; below it the month is `pendingImport` and the analysis is marked out of date instead of silently covering fewer stores.
- **Another service to run** (database, worker, compose, CLI registry) → follows the existing template; additive.

## Migration Plan

Additive: the service is new, nothing existing changes behavior. Steps: scaffold and migrate the new database; import the baseline and packaging; create the initial parameter version; run the engine; run the backtest; read the report with the owner. Rollback: stop and remove the service and its database; no other service references it.

## Open Questions

- How the owner wants backtest results shared (a stored report read through the service is assumed for Phase 1; a screen is Phase 2+).

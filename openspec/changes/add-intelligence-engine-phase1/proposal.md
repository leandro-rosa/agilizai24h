## Why

Commercial Intelligence v2 (Mix × Quantity × Balance × Next restock, per Product × Store) was designed and approved on 2026-09-30 (`docs/commercial-intelligence-v2-design.md`). Phase 0 delivered the data foundation: every supply visit is now stored per SKU with its count, and the balance-quality audit shows 97% of counted lines equal the system balance. What is missing is the decision engine itself. Today's restock suggestion is monthly demand with no balance and no cycle, and its "Aproveitamento" ratio is not a valid indicator.

This change builds Phase 1 of the approved plan: a deterministic, versioned, testable engine in a new `intelligence-service`, plus a backtest that checks it against history **before** any screen exists. No UI, no gateway route and no "how much to bring" in this phase (Phases 2 to 4).

## What Changes

- **New `intelligence-service`** (own Postgres, own queue worker). It reads visits and monthly restocks/removals from `supply-service`, monthly sales from `sales-service`, and cost from `products-service`. It never writes to them.
- **Product × Store engine** as pure functions, producing for each pair: restock **cycles** from visits (censoring-aware), a robust **demand rate**, a temporal **pattern** (stable, growing, declining, volatile, new, insufficient), a **Mix** state (keep, test, evaluate removal, insufficient data) with presence states (sells, low adherence, restocked without sales, no recent restock, never tested), a **Quantity** decision against the current baseline (keep, reduce, increase, test, no evidence to change), **operational alerts** (expiry, damage, other reason, review balance, incomplete data) and three separate **confidence** values (recommendation, balance reliability, priority).
- **Estimated balance** with a reliability status governed by a **configurable tolerance** (default: a count is acceptable when the difference is at most 10% of the system balance or 3 units, whichever is more permissive). The balance can always be shown for consultation, but a Product × Store releases balance-driven use only when it is within tolerance. The gate itself is computed and exposed here; the "how much to bring" calculation that consumes it is Phase 4.
- **Versioned parameters**: every threshold, band and tolerance lives in backend configuration with an append-only version history; every result records the engine version and parameter version that produced it.
- **Baseline quantity** (`qtd itens por loja`) imported from the pricing sheet, one value per SKU applied to every store, with append-only history; `Medida` imported as a product attribute.
- **Visit schedule parameter**: planned visit weekdays (default Monday, Tuesday, Thursday, Friday), overridable per store, stored now for the replenishment interval; its use for the next-visit date arrives in Phase 4.
- **Backtest of the decision process**, not only of the forecast: a rolling-origin replay over January to August 2026 that, for each Product × Store with enough data, records the baseline quantity, the quantity and action the engine would have recommended (keep, reduce, increase, evaluate removal), what happened afterwards (sales, losses, economic result) and whether the recommendation would have been coherent with it — a reduction that would have cut losses without hurting sales, an increase that later behavior sustains. Demand-forecast error is one metric among these. Coherence is an estimate over history that cannot be replayed, and is labelled as such. Thresholds stay provisional until the report is read together with the owner.
- **Coherence wording**: "coherent" means only that the data that followed are compatible with the recommendation under the stated criteria, never that it was proven correct; conflicting evidence is inconclusive. A reduction shows, separately, the losses and sales that followed, the cycles in which demand exceeded the recommended quantity, the units of loss potentially avoidable and the units of sales potentially at risk.
- **Coverage report**: how many Product × Store can be analysed and, mutually exclusively, how many have a reliable balance, an unreliable balance, not enough counts, conflicting data or insufficient history.
- **Impact of the count rules before they are definitive**: a sensitivity report showing the real coverage under alternative values of counts considered, minimum counts, maximum count age and tolerance. The defaults (3 counts, minimum 1, 45 days) stay configurable and provisional; nothing is chosen until the owner has seen their impact.
- **Mandatory monthly refresh**: when a month is closed and imported (supply and sales both present), everything the intelligence produces is recomputed over the history including it — cycles, patterns, Mix and Quantity recommendations, estimated balance and reliability, backtest, coverage and sensitivity reports. The new month is added to the history; earlier computations stay stored and readable. Every result states "data updated through <month>" and "last updated <date>", and an analysis that lags a closed month is marked out of date and never presented as current. The service provides these two facts and the out-of-date mark; showing them on screen is a requirement carried into Phase 2.
- **Known limitation, stated up front**: the platform has no history of the parametrized quantity before September 2026, so the backtest uses the baseline of record for every origin and says so.
- Engine runs go through a queue and persist results; they are read through service endpoints used by the backtest and by later phases.

Out of scope here: any admin screen, gateway route, drawer, matrix, "how much to bring", decision log, products-service schema changes beyond the already existing packaging fields, similar-store opportunity and box-splitting optimisation (architecture only, as the plan states).

## Capabilities

### New Capabilities
- `intelligence-engine`: the Product × Store decision engine — cycles, demand, pattern, Mix, Quantity, alerts, confidence, estimated balance with reliability, and the determinism and no-automatic-action guarantees.
- `intelligence-parameters`: versioned, backend-owned configuration (tolerance, bands, thresholds, visit weekdays, baseline quantity history) and the rule that every result is stamped with the versions used.
- `intelligence-backtest`: the rolling-origin replay and its reported metrics.

### Modified Capabilities
<!-- None. `supply`, `sales` and `products` are read as they are; new routes there are an implementation detail, not a requirement change. -->

## Impact

- New `backend/apps/intelligence-service` (module layout, Prisma + adapter-pg, BullMQ worker via `@app/hold-it`, Dockerfile, compose, `CLAUDE.md`), registered in `agiliz-cli` and `.env.example` (Postgres host port 5446).
- Reads from `supply-service` (`GET /supply/:storeId/visits`, `GET /visits/stores`, period removals), `sales-service`, `products-service`; no change to their behavior.
- `docs/commercial-intelligence-v2-design.md` stays the reference; this change **supersedes the unstarted scope of `add-commercial-intelligence-governance`** for the new engine (that change covers the frozen old engine).
- Related, untouched: Loss Intelligence stays an input; the balance-quality audit stays as the measurement view.
- Real data only: backtest and tests use fixtures shaped like the real reports; nothing synthetic is written to a real database.

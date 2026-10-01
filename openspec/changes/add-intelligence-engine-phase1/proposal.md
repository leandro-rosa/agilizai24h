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
- **Backtest**: rolling-origin replay over January to August 2026 that measures demand-forecast error and what happened after each recommendation (stock-outs, expiry loss), reported per Product × Store and in aggregate. Thresholds stay provisional until the backtest is read together with the owner.
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

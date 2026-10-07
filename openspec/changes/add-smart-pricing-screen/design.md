## Context

See proposal.md for motivation. State this builds on (branch `feat/smart-pricing-engine`):

- `intelligence-service` has the pure engine, versioned pricing parameters, read clients and `GET /pricing/report` computed **in the request** (60 s cache). It never writes to another service (`no-writes.spec.ts`).
- `gateway-service` exposes `/pricing/report`, `/pricing/products/:sku` and the parameter routes; it has the session and the user, and is the only HTTP entry.
- `products-service` writes a price with `recordPrice` (`POST /products/:sku/prices`), which **upserts by (product, effective date)**: a second price on the same date replaces the first.
- `treasury-service` has `GET/POST /treasury/fees` and `/fees/in-force`; no admin screen registers fees.
- The admin already uses `@react-pdf/renderer` (dark brand PDF in `lib/overview/pdf/report.tsx`) and `xlsx`, RTK Query one file per domain in `src/lib/api/`, `RequestState` for loading / empty / error, shadcn `Sheet` and `Dialog`, and the rule that a missing figure is "—" or "Indisponível", never zero.
- The catalogue has no image field; it does have EAN, category (`meal | snack | beverage | essential`) and subcategory.

## Goals / Non-Goals

**Goals:**
- A screen that answers product → problem → recommended price → reason → impact → action, from one stored report.
- Every number that shapes a recommendation, a simulation or a history flag is computed in the backend; the browser formats, sorts, filters and exports.
- Applying a price is explicit, traceable and consistent across two services.

**Non-Goals:**
- No Smart Supply content, no per-store payment mix, no product images, no automatic price changes, no demand-elasticity model.
- No fee or tax rate is written to a real database by this work; the owner registers them (screen) with a start date.

## Decisions

**1. Route `/purchases/pricing`, fees at `/treasury/fees`.** Pricing goes in Compras (owner decision). Fees are treasury data with their own permission, so registering them lives in Tesouraria; the pricing rules modal only reads them and links there, which keeps "do not duplicate financial rates" true. Alternative: a fees tab inside the rules modal. Rejected: it would make pricing look like the owner of the rates.

**2. The report is a stored run, started explicitly.** A `pricing_run` table (period, store or null for the network, status, engine and parameter version, computed_at, error, report as JSON) and a BullMQ job reuse the run pattern of the mix engine. `GET` returns the latest completed run and never computes; `POST` starts one and de-duplicates a run already in progress. A failed run keeps its reason and does not replace the latest completed one. This also fixes the open task 7.1 of the previous change and makes the screen fast and its numbers reproducible (the exact parameters and engine version are on the run). Alternative: keep computing in the request. Rejected: catalogue × stores × months of reads on every page open.

**3. Filtering, sorting and pagination are client-side over the stored report.** About 400 products per scope fit in memory; the cards describe the whole scope, the table and sections the filtered view. Rules that shape a recommendation (status, confidence, prices, impact, cost-change impact) are never recomputed in the browser. Alternative: server-side filtering. Rejected for now: more routes for no gain at this size; revisit if a scope grows past a few thousand.

**4. Report additions are computed in the engine run, not in the browser.** Supplier name, EAN, category label (a backend map `beverage → Bebidas`, `snack → Snacks`, `meal → Refeições`, `essential → Essenciais`, anything else → `Outros`), previous-cost margin and the margin change in percentage points are added by the run. Margin overrides stay keyed by the category key.

**5. History uses the product margin, not the economic one.** Per month: cost and price in force at month end (existing dated reads), margin `(p − c) / p`, markup `p / c`, flags against the previous month. It is labelled the product margin because the economic structure (tax, fees, loss, allocation) of past months is not stored per month and recomputing it would invent history. Alternative: apply today's structure to every month. Rejected: it would mislead.

**6. Simulation is a backend route over the stored structure.** It takes the cost structure of the product in the latest completed run and applies the same formulas as the engine, so a simulated price and a recommended price are comparable. It reads no other service and writes nothing. A product without a structure is "not simulable". The simulator in the drawer calls it on input with a short debounce.

**7. The Lojas tab uses the store's own volume and loss with the network's payment cost and allocation.** Computing a payment mix and a P&L per store per product would multiply reads; the tab says which parts are the network's. Stores that never recorded the period are listed as missing.

**8. "Apply price" is orchestrated by the gateway, not by intelligence-service.** The mix engine's rule is "recommends, never acts", enforced by a test that allows one writer. The gateway already holds the session and the user, so it runs: (1) record a `pending` decision in intelligence-service with an idempotency key, (2) `POST /products/:sku/prices`, (3) mark the decision `applied` or `failed`. A failed price write leaves a `failed` decision, never a silent half-change. Because `recordPrice` upserts by date, a same-day second price replaces the first in the catalogue; the decision keeps the previous price so nothing is lost. The effective date defaults to today. Alternative: let intelligence-service call products-service. Rejected: it would break the no-writes guard that protects the engine.

**9. Decisions live in intelligence-service** (table `pricing_decision`), next to the runs and parameter versions they reference. The recommended price, confidence, run id and parameter version are copied into the decision so it stays explainable if the run is later replaced.

**10. Export is generated in the browser from the report in view.** Excel with `xlsx` (one sheet per section plus a metadata sheet), PDF with `@react-pdf/renderer` reusing the dark theme of the overview PDF. Both take the same view model as the screen, so they cannot disagree. Numbers are numbers in Excel and gaps are empty cells.

**11. Visual identity follows the existing admin tokens** (`DESIGN.md`, `docs/BRAND.md`): primary magenta for the main action, green / yellow / red only for status, `.tabular` on every number column, Montserrat. Empty, loading and error states use `RequestState`. `pnpm contrast` runs if a token is touched.

## Risks / Trade-offs

- [Two writes across services can half-fail] → Decision first as `pending`, price second, decision `applied` / `failed` last, idempotency key, and a reconciliation read that lists `pending` decisions older than a few minutes.
- [A stored run goes stale after a parameter change, a new fee or a price change] → The screen shows the run's computation time and parameter version, says when the current parameters differ from the run's, and offers "Recalcular". A parameter change never silently alters a stored run.
- [Client-side filtering diverges from the cards] → Cards are computed by the backend over the whole scope and labelled as such; filtered counts are shown next to the table.
- [The per-store tab can mislead] → It states which components are the network's.
- [A recommendation applied on thin data] → The apply action is available only when the product has a recommendation or the user types a price with a reason; low confidence is shown beside the action.
- [Real-data check is blocked] → Fees and the tax rate are not registered and the owner has not authorised writing them; the screen is verified with the empty / insufficient-data states and fixtures until then.

## Migration Plan

Additive. Two new tables in `intelligence-service` (run, decision) with a migration each; new gateway routes; new admin routes and sidebar entries. Rollback is removing the routes and the module; no existing table changes and no price is touched until a user applies one.

## Open Questions

- Default effective date of an applied price (proposed: today); a date picker can be added later without changing the model.
- Whether the owner wants a "Aplicar" in bulk for several products at once (not in this change).

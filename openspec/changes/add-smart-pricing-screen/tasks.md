## 1. Report additions (intelligence-service)

- [x] 1.1 Add to each report product: SKU, EAN, supplier (id and name, none when absent), category key and Portuguese label (unknown → "Outros"), subcategory
- [x] 1.2 Compute the margin at the previous cost and at the current cost and the change in percentage points, per product
- [x] 1.3 Unit tests with hand-computed fixtures: cost rising 2,80 → 3,09 at an unchanged price; product without a supplier; unknown category

## 2. Stored runs (intelligence-service)

- [x] 2.1 Table `pricing_run` (period, store or null, status, engine and parameter version, computed_at, error, report JSON) and its migration
- [x] 2.2 Queue and worker that execute the report for a scope and store it; de-duplicate a run already in progress; a failed run keeps its reason and does not replace the latest completed one
- [x] 2.3 Routes: start a run, read the latest completed run with its freshness and the last failure, "no run yet" as an explicit answer
- [x] 2.4 Tests: reading does not run the engine, de-duplication, failure keeps the previous run, no-run answer
- [x] 2.5 Set `WITH_KAFKA_BROKERS=false` in the new test setup and register the queue in the app module

## 3. History, simulation and stores (intelligence-service)

- [x] 3.1 Monthly history of a product: cost and price in force at month end, margin, markup and the four flags; empty values for missing cost or price
- [x] 3.2 Simulation route over the stored cost structure with the engine formulas, rejecting a price that is not a positive whole number of centavos, and "not simulable" for a product without a structure
- [x] 3.3 Per-store view: units, revenue, loss and estimated margin per store, missing stores listed as missing
- [x] 3.4 Tests: month without cost, price-change flag, simulated price equals the engine value for the same price, product without a structure, store without data

## 4. Decisions (intelligence-service and gateway)

- [x] 4.1 Table `pricing_decision` and its migration (product, previous and new price, effective date, user, recommended price and confidence, run and parameter version, reason, status, idempotency key, error)
- [x] 4.2 Routes in intelligence-service to record a decision, mark it applied or failed, and list a product's and the latest decisions; the reason is required when the new price differs from the recommendation
- [x] 4.3 Gateway orchestration of apply: record pending, write the price with `POST /products/:sku/prices`, mark applied or failed; product write permission; idempotent on the key
- [x] 4.4 A read that lists pending decisions older than a few minutes
- [x] 4.5 Tests: accepting the recommendation, a different price without a reason, price write failure leaves a failed decision, repeated request creates one decision, two same-day changes keep both previous prices, permission refused

## 5. Gateway routes

- [x] 5.1 Routes for runs (start, read), history, simulate, stores, decisions (apply, list), reusing the existing permission decorators
- [x] 5.2 Confirm `no-writes.spec.ts` of intelligence-service still passes: the only price write is in the gateway

## 6. Admin foundation

- [x] 6.1 Sidebar entry "Precificação Inteligente" in Compras (`/purchases/pricing`) and "Taxas de pagamento" in Tesouraria (`/treasury/fees`), with their read permissions
- [x] 6.2 RTK Query file `src/lib/api/pricing.ts` (runs, report, product, history, simulate, stores, decisions, parameters) and fee endpoints in `treasury.ts`
- [x] 6.3 Pure helpers in `src/lib/pricing/` (status and confidence labels, money and percent formatting that never turns a missing value into zero, filters, sorts, view model shared by screen and exports) with a spec per module

## 7. Pricing screen

- [x] 7.1 Header, month and store selector (with "Todas as lojas"), run freshness and "Recalcular"
- [x] 7.2 Filters (category, supplier, product, status, margin band, below target, cost changed), combinable and clearable
- [x] 7.3 The six top cards with "Impacto potencial estimado" and "Indisponível" states
- [x] 7.4 Product table: columns, five sorts, pagination, "—" with a reason for products without a recommendation, status and confidence badges
- [x] 7.5 Banner for missing fees, unset tax rate and other report notes, linking to where to fix them
- [x] 7.6 Sections: Principais oportunidades, Custos que mais mudaram, Margem por categoria
- [x] 7.7 Loading, empty, no-run-yet and error states with `RequestState`

## 8. Drawer

- [x] 8.1 Visão geral: product, current situation, the three prices with confidence, "Por que a IA recomenda esse preço?", estimated impact, cost structure with the analysis-only statement
- [x] 8.2 Simulador calling the backend with a short debounce; no price is changed
- [x] 8.3 Histórico table with the four markers
- [x] 8.4 Lojas table with the note that fees and allocation are the network's
- [x] 8.5 The product's decisions listed in the drawer

## 9. Business rules modal

- [x] 9.1 Show the version in force and earlier versions; edit target, minimum, per-category margins, rounding, psychological price, minimum sales, minimum confidence, tax rate and brand aliases; show every validation problem at once
- [x] 9.2 Say that a change applies on the next run; show the fees in force read-only with a link to `/treasury/fees`
- [x] 9.3 Hide editing for users without the product write permission

## 10. Fees screen

- [x] 10.1 `/treasury/fees`: list by acquirer and method with rate, fixed amount, start date, "in force today", and methods without a rate shown as missing
- [x] 10.2 Registration form in percent and reais, confirmation step showing acquirer, method, rate, fixed amount and start date, conflict and validation errors shown, treasury write permission

## 11. Apply price

- [x] 11.1 "Aplicar novo preço" in the drawer: accept the recommendation or type a price, reason required when it differs, effective date today, confidence shown beside the action
- [x] 11.2 Show the outcome (applied or failed with the reason) and refresh the product after applying
- [x] 11.3 Only for users with the product write permission

## 12. Export

- [x] 12.1 Excel from the report in view: products, costs that changed, margin by category, and a metadata sheet with versions and data-quality notes; numbers as numbers, gaps as empty cells, filters applied
- [x] 12.2 PDF in the dark brand theme: period and scope, average margin, below target, opportunities, cost changes, recommended prices with impact, data-quality observations
- [x] 12.3 Both disabled with an explanation while no report is loaded; specs for the pure parts

## 13. Documentation

- [x] 13.1 Add a `/purchases/pricing` section and the fees screen to the admin `CLAUDE.md`; update the intelligence-service and gateway `CLAUDE.md`

## 14. Verification

- [x] 14.1 `pnpm turbo run lint typecheck` and the tests of every touched package; `pnpm contrast` if a token changed
- [x] 14.2 Check the screen in the browser at desktop and phone width against the empty, insufficient-data and error states; confirm no price version is created by reading, running or simulating
- [ ] 14.3 With the owner's authorisation and start dates: register the fees and the tax rate, run for one store and one month, review the report with the owner before relying on it
- [x] 14.4 Confirm the Smart Supply engine, its screen and its parameter version are unchanged

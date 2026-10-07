## Why

The pricing engine from `add-smart-pricing-engine` computes minimum, target and recommended prices, but nothing shows them: there is no screen, no way to apply a price, no history, no simulator and no way to register the payment fees it depends on. Until there is, the owner still answers "is my price right?" from a spreadsheet, and the engine's output cannot be checked against real products.

## What Changes

- **A new screen, "Precificação Inteligente", at `/purchases/pricing`** (group Compras of the sidebar): header, filters, six top cards, a sortable product table, and the sections Principais oportunidades, Custos que mudaram and Margem por categoria. Priority order on screen: product → problem → recommended price → reason → impact → action; no chart-heavy BI.
- **A product drawer** (no page navigation) with Visão geral (including the cost structure), Simulador, Histórico and Lojas.
- **A "Regras de negócio" modal** that edits the versioned pricing parameters; financial rates are shown read-only with a link to where they are registered.
- **Payment fees screen** at `/treasury/fees` (group Tesouraria) to register acquirer and voucher-brand rates with a fixed amount per sale and a start date. Fees live in treasury, so the pricing modal only reads them.
- **Applying a price**: the user approves a recommendation (or types another price) with a reason; the system writes the new price version and records the decision (previous price, new price, date, user, the engine's recommendation, reason). The engine itself never writes a price.
- **Export**: Excel and PDF built from the same report the screen shows, with the data-quality observations.
- **Backend additions the screen needs**: per-product monthly history, a simulation route (the rule lives in the backend), supplier / EAN / Portuguese category label and the margin impact of a cost change on every product in the report, and the catalogue report computed by a queue job and stored with the engine and parameter versions.
- **Not in scope**: the Smart Supply (Abastecimento Inteligente) engine and screen, product images (the catalogue has no image field), per-store payment mix, automatic price changes, and registering any fee or tax rate in a real database without the owner's authorisation.

## Capabilities

### New Capabilities
- `pricing-screen`: the `/purchases/pricing` screen, its filters, cards, table, sections, drawer and rules modal, and the empty / insufficient-data states.
- `pricing-analysis-reads`: stored catalogue report runs, per-product monthly history, simulation, per-store view and the report fields the screen needs.
- `pricing-decisions`: applying a recommended or typed price with approval and the history of those decisions.
- `pricing-export`: Excel and PDF of the report.
- `payment-fees-screen`: registering and listing payment fees from the admin.

### Modified Capabilities
<!-- None: pricing-engine and payment-fees are still deltas of add-smart-pricing-engine and are not in openspec/specs yet; this change only builds on them. -->

## Impact

- `frontend/apps/admin`: new route `src/app/(app)/purchases/pricing/`, new route `src/app/(app)/treasury/fees/`, an RTK Query file `src/lib/api/pricing.ts` (plus fees in `treasury.ts`), pure view helpers in `src/lib/pricing/`, components under `src/components/pricing/`, sidebar entries in `components/app-sidebar.tsx`, and a section in the admin `CLAUDE.md`.
- `backend/apps/intelligence-service`: a stored-run table and queue worker for the report, history / simulate / stores reads, report enrichment, and the decision table.
- `backend/apps/gateway-service`: pricing routes (runs, history, simulate, decisions) and the orchestration of "apply price" across products-service and intelligence-service.
- `backend/apps/products-service`: no schema change; the price write reuses `POST /products/:sku/prices`.
- Depends on the branch `feat/smart-pricing-engine` (change `add-smart-pricing-engine`), which must be merged first or stacked.
- Real-data verification stays blocked until the owner gives the fees' start dates and authorises writing fees and the tax rate to the dev database.

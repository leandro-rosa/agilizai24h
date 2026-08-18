## Why

This is the change the platform exists for. Everything before it collects the inputs; this
one produces the four numbers the operators currently compute by hand, per store, every
month: **restocked value, cost of goods sold, remaining stock value, and real loss** —
the last one broken down by reason and by product.

Every input is now available: quantities from `sales-service`, `supply-service` and
`inventory-service`; dated costs and name matching from `products-service`; the loss
classification from `supply-service`. Nothing multiplies them together.

The mocked `finance` slice in `frontend/apps/admin` is a generic revenue/expense ledger with
free-text categories. It models a bookkeeping app, not this reconciliation, and is replaced
rather than extended.

## What Changes

- **New `backend/apps/finance-service`** — computes and serves the monthly reconciliation per
  store, with its own Postgres database.
- **The four reconciliation figures**, each valued using the cost that was current for the
  month being reconciled, never today's cost.
- **Loss broken down by reason and by product**, in both units and currency.
- **A completeness statement on every reconciliation** — which SKUs could not be priced or
  matched — so a total is never presented as authoritative when it is not.
- **Recomputation driven by the period-data-updated event** from `supply-service`, so figures
  follow ingestion without anyone asking.
- **Network-level rollups** across stores for a month, for the dashboard.

Not in scope: the finance UI (`add-web-real-data`), any general-ledger or accounts
payable/receivable modelling, tax, and forecasting.

## Capabilities

### New Capabilities

- `reconciliation`: the per-store, per-month valuation of restocking, sales and loss — the
  computation that replaces the manual spreadsheet process.

### Modified Capabilities

None.

## Impact

- **New**: `backend/apps/finance-service/` and its own Postgres.
- **Modified**: `cli/agiliz-cli`, `cli/CLAUDE.md`, `backend/CLAUDE.md`.
- **Reads**: `supply-service` (restock and per-reason removal quantities), `sales-service`
  (quantities sold and revenue), `inventory-service` (remaining stock quantities), and
  `products-service` (as-of costs).
- **Consumes**: the period-data-updated event from `supply-service`.
- **Read by**: the panel through `gateway-service`.
- **Correctness-critical**: this is where a wrong dated-cost lookup, a mishandled unpriced
  SKU, or a misapplied loss classification becomes a wrong number in front of the business.

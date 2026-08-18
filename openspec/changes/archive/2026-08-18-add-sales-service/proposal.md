## Why

Sales are one of the three inputs the monthly reconciliation consumes: they supply the
quantities sold that become COGS when valued at cost, and they are half of the arithmetic
that derives remaining stock (restocked minus sold minus removed).

Nothing stores them today. `frontend/apps/admin` mocks 60 transaction-shaped sales with
payment methods and line items — a plausible e-commerce shape, but not what the POS
actually exports. The real sales report is one file per store listing, per SKU, the quantity
sold and the revenue for a period.

This service must exist before `add-ingestion-flow`, which has nowhere to write parsed
sales rows without it.

## What Changes

- **New `backend/apps/sales-service`** — owns persisted sales records, with its own Postgres
  database.
- **Sales records keyed by store, period and SKU**, matching the grain the reports arrive
  in, rather than a synthetic per-transaction model the source data cannot support.
- **Idempotent ingestion writes**, so re-uploading the same report for the same store and
  period corrects the data instead of doubling it.
- **Aggregated reads per store and period**, the shape `finance-service` and
  `inventory-service` consume.
- **A record of provenance** — which upload a row came from — so a wrong figure can be
  traced back to the file that produced it.

Not in scope: parsing the spreadsheet (`add-ingestion-flow`), valuing sales in currency
(`finance-service` does that using `products-service` costs), and the sales UI
(`add-web-real-data`).

## Capabilities

### New Capabilities

- `sales`: persisted quantities sold and revenue per store, per period, per SKU — the
  authoritative record of what left the stores through the checkout.

### Modified Capabilities

None.

## Impact

- **New**: `backend/apps/sales-service/` and its own Postgres.
- **Modified**: `cli/agiliz-cli`, `cli/CLAUDE.md`, `backend/CLAUDE.md`.
- **Written by**: `ingestion-worker-service`, asynchronously via `@app/hold-it`.
- **Read by**: `finance-service` (COGS), `inventory-service` (stock derivation), and the
  panel through `gateway-service`.
- **Ordering note**: this change is inserted before `add-ingestion-flow`, which the original
  roadmap listed first. Ingestion cannot persist sales rows into a service that does not
  exist.

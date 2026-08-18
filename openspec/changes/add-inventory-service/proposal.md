## Why

"How much is actually on the shelf" is a question nobody can answer today without the
spreadsheet. It is also the quantity behind *remaining stock value* — one of the four figures
the monthly reconciliation produces.

The data to answer it already exists once `sales-service` and `supply-service` are in place:
stock is what was restocked, minus what was sold, minus what was removed. Nothing computes
that. `frontend/apps/admin` mocks a flat `quantity` per store and SKU with a hardcoded
`minimum` (15 for beverages and essentials, 8 otherwise) that is not a real per-SKU setting.

Keeping this separate from `finance-service` is deliberate: this service answers in **units**,
finance answers in **currency**, and they are read by different screens for different reasons.

## What Changes

- **New `backend/apps/inventory-service`** — derives and serves stock levels per store and
  SKU, with its own Postgres database.
- **Stock derived from the movement record**, not entered by hand: restocked minus sold minus
  removed, across every period up to a point in time.
- **Recomputation triggered by the period-data-updated event** from `supply-service`, so stock
  follows ingestion automatically.
- **Point-in-time stock**, so closing stock for a month can be read as of that month's end
  rather than only as "now".
- **Configurable minimum levels per store and SKU**, replacing the mock's hardcoded rule, so
  a low-stock signal means something.
- **Explicit handling of negative derived stock**, which indicates a data problem rather than
  a real quantity and must be visible instead of clamped.

Not in scope: valuing stock in currency (`finance-service`), reorder or replenishment
workflows, and the inventory UI (`add-web-real-data`).

## Capabilities

### New Capabilities

- `inventory`: stock levels in units per store and SKU, derived from recorded movements, and
  the minimum levels that make a low-stock signal meaningful.

### Modified Capabilities

None.

## Impact

- **New**: `backend/apps/inventory-service/` and its own Postgres.
- **Modified**: `cli/agiliz-cli`, `cli/CLAUDE.md`, `backend/CLAUDE.md`.
- **Reads**: `sales-service` and `supply-service` over HTTP for the movement quantities.
- **Consumes**: the period-data-updated event published by `supply-service`.
- **Read by**: `finance-service` (remaining-stock quantities to value) and the panel through
  `gateway-service`.

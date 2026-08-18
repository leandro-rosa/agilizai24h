## Why

This service owns the rule the whole platform exists to get right: **not every removal is a
loss**. The distinction has already been validated against several months of production data
from the source system, and getting it wrong misstates the loss figure in currency — the
single number the operators are trying to control.

Six removal reasons appear in the reports. Three are real loss (expired, damaged, other
reason); three are not (return, transfer, internal use). Worse, a single removal line can
mix them — `-6 Devolução, -3 Outro motivo` means three units of loss and six units that are
not — so a line cannot be classified as a whole.

Restocking is the other half: it supplies the quantities that, minus sales and removals,
derive remaining stock.

`frontend/apps/admin` mocks this domain as generic "supply requests" with a status and a
scheduled date — a purchasing workflow that has nothing to do with the reconciliation model
described above. The mock is a placeholder, not a specification.

## What Changes

- **New `backend/apps/supply-service`** — owns restock and removal records per store, period
  and SKU, with its own Postgres database.
- **Loss classification as first-class business logic**: each reason is explicitly
  loss-counting or not, and the classification is data the platform can report on, not a
  condition buried in a query.
- **Per-reason removal quantities**, so a mixed-reason line is stored already split and no
  consumer has to re-parse free text.
- **Derived loss quantities** per store, period, SKU and reason — the input
  `finance-service` values in currency.
- **A "period data updated" event**, published via `@app/hold-it`, which triggers
  recomputation downstream without coupling this service to reconciliation internals.
- **Idempotent ingestion**, matching the contract established by `sales-service`.

Not in scope: parsing the free-text reason breakdown out of the spreadsheet
(`add-ingestion-flow` does that and delivers already-split quantities), valuing loss in
currency (`finance-service`), and stock levels (`inventory-service`).

## Capabilities

### New Capabilities

- `supply`: restocking and removal records per store and period, and the classification that
  determines which removed units count as real loss.

### Modified Capabilities

None.

## Impact

- **New**: `backend/apps/supply-service/` and its own Postgres.
- **Modified**: `cli/agiliz-cli`, `cli/CLAUDE.md`, `backend/CLAUDE.md`.
- **Written by**: `ingestion-worker-service` via `@app/hold-it`.
- **Read by**: `finance-service` (loss and restocked quantities to value) and
  `inventory-service` (stock derivation).
- **Publishes**: the period-data-updated event that `finance-service` consumes.
- **Correctness-critical**: the classification rule and the mixed-reason split are the two
  places where a plausible implementation produces a wrong loss figure.

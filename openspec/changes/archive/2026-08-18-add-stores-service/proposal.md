## Why

Every other domain is keyed by store: sales, restocking, inventory and the monthly
reconciliation are all computed *per store, per month*. Nothing can reference a real store
until stores exist as data, so this service is a prerequisite for the ingestion and
reconciliation work rather than a feature in its own right.

Today `frontend/apps/admin` serves 18 fictional stores from `src/mocks/stores.ts` through a
`mockBaseQuery`. The mock captures the shape the panel already renders — name, address,
city, status, type — but none of it is real, and there is no way to add a store.

## What Changes

- **New `backend/apps/stores-service`** — a NestJS HTTP service owning the store registry,
  with its own Postgres database and Prisma schema.
- **Store records** carrying the identity the rest of the platform joins against, plus the
  attributes the panel already displays.
- **A stable external store code** — the identifier the POS/touchpay exports use to name a
  store, kept distinct from the internal id, so uploaded spreadsheets can be matched to a
  store without guessing from a display name.
- **Create and update operations**, which the panel does not have today (it is list-only).
- **Deactivation instead of deletion**, because historical sales and reconciliations must
  keep resolving their store even after it closes.

Not in scope: the panel's UI for managing stores (`add-web-real-data`), any per-store
authorization scoping, and store-level configuration of products or pricing.

## Capabilities

### New Capabilities

- `stores`: the registry of physical Agiliz.AI locations — their identity, lifecycle, and
  the external code that ties uploaded operational reports back to a store.

### Modified Capabilities

None.

## Impact

- **New**: `backend/apps/stores-service/` (NestJS app, Prisma schema and migrations,
  Dockerfile, `docker-compose.yml`, `CLAUDE.md`, `.env.example`) and its own Postgres.
- **Modified**: `cli/agiliz-cli` (new `stores` project), `cli/CLAUDE.md`,
  `backend/CLAUDE.md`.
- **Consumed by**: `gateway-service` over HTTP; `supply`, `sales`, `finance` and
  `inventory` reference stores by id and resolve external codes during ingestion.
- **Blocks**: `add-ingestion-flow` cannot map a spreadsheet to a store without the external
  code defined here.

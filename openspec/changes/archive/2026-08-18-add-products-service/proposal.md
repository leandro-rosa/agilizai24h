## Why

Every currency figure the platform produces — restocked value, COGS, remaining stock value,
real loss — is a quantity multiplied by a cost. That cost lives in a price/cost reference
spreadsheet today, and it changes over time.

Two properties make this more than a product table:

- **A month must be valued with the cost that was current for that month.** Re-opening
  March next year must not reprice March with today's costs, or every historical figure
  silently changes whenever someone uploads a new price sheet.
- **The POS product name does not reliably match the price sheet name.** Matching needs
  normalisation and a curated override table, and any SKU that cannot be priced must be
  *reported*, never dropped from a total — a silently omitted SKU understates loss and
  COGS with no visible symptom.

`frontend/apps/admin` currently mocks 18 products with a single mutable `price` field and
no notion of cost, history, or matching.

## What Changes

- **New `backend/apps/products-service`** — owns products/SKUs and the canonical cost
  reference, with its own Postgres database.
- **Dated cost versions**: a cost is recorded with the period it takes effect from, and
  cost lookups are always *as of* a date rather than "current".
- **Name normalisation and a curated override table** for matching POS product names to
  canonical products, with deterministic precedence between the two.
- **An explicit unmatched-SKU report**, so a caller valuing a period can surface what it
  could not price instead of returning a quietly wrong total.
- **Cost lookup for a set of SKUs at a given date**, the operation `finance-service` and
  `supply-service` call when valuing a period.

Not in scope: ingesting the price sheet itself (`add-ingestion-flow` uploads and parses it,
then writes here), and product management UI (`add-web-real-data`).

## Capabilities

### New Capabilities

- `products`: the canonical catalogue of SKUs, the dated cost reference used to value every
  period, and the name-matching rules that connect POS exports to catalogue entries.

### Modified Capabilities

None.

## Impact

- **New**: `backend/apps/products-service/` and its own Postgres.
- **Modified**: `cli/agiliz-cli`, `cli/CLAUDE.md`, `backend/CLAUDE.md`.
- **Consumed by**: `finance-service` and `supply-service` over HTTP for as-of cost lookups;
  `ingestion-worker-service` writes parsed price-sheet rows and resolves product names.
- **Blocks**: `add-finance-service` — no period can be valued in currency without this.
- **Correctness-critical**: the dated-cost rule and the unmatched-SKU rule are the two
  places where a plausible-looking implementation produces wrong money.

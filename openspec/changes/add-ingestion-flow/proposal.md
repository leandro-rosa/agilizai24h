## Why

The domain services can hold sales, supply and cost data, but nothing can get data into
them. Today the operators do this by hand in a spreadsheet tool, every month, for every
store — the manual process this platform exists to replace.

Three files arrive per month: a sales report per store, one restocking/removal workbook with
a sheet per site visit, and a price/cost reference. They are large enough that parsing them
inside an HTTP request would time out, and important enough that a partial or duplicated
import silently corrupts every figure derived from it.

This change also owns the one piece of parsing with real business logic in it: splitting the
free-text `Removals` field (`-6 Devolução, -3 Outro motivo`) into per-reason quantities.
`supply-service` deliberately refuses to interpret text, so this is where that happens.

## What Changes

- **Upload endpoints on `gateway-service`** for the three file types, storing the raw file
  via `@app/aws`'s `S3Service` and returning immediately with an ingestion identifier — the
  request never waits for parsing.
- **New `backend/apps/ingestion-worker-service`** — `HoldItWorkerHost` consumers that parse
  uploaded workbooks with `@app/sheeter`'s `smartChunk` and publish normalised rows to the
  owning domain services.
- **One queue per file type**, not a single generic "parse anything" queue, so each parser
  has its own payload contract and failure surface.
- **Free-text removal-reason parsing**, splitting a mixed-reason line into per-reason
  quantities before `supply-service` ever sees it.
- **Ingestion status and error reporting**, so an operator can see what a file did — rows
  accepted, rows rejected, and exactly why — instead of watching data appear or not.
- **Idempotency by store and period**, matching the replacement contract `sales-service` and
  `supply-service` already define.

Not in scope: the upload UI (`add-web-real-data`), the reconciliation computation
(`add-finance-service`), and any automated fetch from the POS platform — files are uploaded
by a person.

## Capabilities

### New Capabilities

- `ingestion`: accepting operational spreadsheets, parsing them off the request path,
  normalising their rows into domain records, and reporting what succeeded and what did not.

### Modified Capabilities

- `api-gateway`: gains the upload routes and the ingestion-status routes, which are the
  first endpoints that hand work to a queue rather than to a domain service.

## Impact

- **New**: `backend/apps/ingestion-worker-service/` (no HTTP surface of its own; it consumes
  queues). Raw files land in object storage, never in Postgres.
- **Modified**: `gateway-service` (upload and status routes, first use of `@app/hold-it`
  there), `cli/agiliz-cli`, `cli/CLAUDE.md`, `backend/CLAUDE.md`.
- **Depends on**: `stores-service` (resolving the external store code),
  `products-service` (resolving product names and writing parsed costs), `sales-service` and
  `supply-service` (the write targets).
- **Correctness-critical**: the reason-splitting rule, and the requirement that an
  unparseable row is reported rather than dropped.

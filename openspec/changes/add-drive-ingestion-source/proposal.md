## Why

The monthly sales and restocking reports that feed this platform are dropped into a shared Google Drive every month (`My Drive › agiliz.ai › Vendas x abastecimento › <month> › Relatório_2026`, next to the older per-store files and the restocking report). Today someone has to download each file and upload it by hand in `/ingestion`, stating the file type and the period. That is a recurring manual step on the critical path of every monthly closing, and it is the reason the detailed months (with the per-transaction `Cupom`, `Data/Hora` and `Categoria produto` columns) are not in the system: nobody has time to backfill them one by one.

The operator wants the platform to notice new files in the Drive and to check them by itself, while keeping a person in control of every import: ingesting a month replaces that period's data and triggers downstream recomputation of finance and stock, and a file that is incomplete, duplicated or attributed to the wrong month must never get in silently.

## What Changes

- **A Drive source for ingestion**, read-only, configured by a service account and a root folder id (the `Vendas x abastecimento` folder). When it is not configured the feature is inert: the worker boots normally and the admin says "Drive não configurado".
- **Daily automatic scan at 06:00 (America/Sao_Paulo) and a "Sincronizar agora" action.** A scan reads **metadata only** (name, path, size, checksum, modified time) and only tracks files whose name matches configurable patterns (by default the report and restocking files), so the old per-store files do not clutter the list.
- **Automatic validation, never automatic import.** For every new or changed file the system downloads it to a temporary location, computes checks, keeps **only an aggregated report** (no rows, no card digits, no buyer numbers), deletes the temporary file, and shows the result before the person decides. Validation writes nothing to object storage and creates no ingestion. It can be switched off, leaving a manual "Validar" action.
- **The checks**: the file's format matches its type; the period identity (the selected month matches the dates in the file); the month edges (the file does not start or stop early); **per-store coverage measured on the days each store is expected to operate, not on calendar days**; duplicate content; the size limit.
- **Insufficient coverage is flagged, not imported and not silently refused.** The inconsistencies are listed and the person must explicitly validate them before Import is possible; that validation is bound to the exact content reviewed and recorded. A wrong period, a wrong format, a duplicate or an oversized file stay blocked.
- **Duplicate-import prevention** on four layers: one row per Drive file, an atomic guard against concurrent clicks, unchanged files never proposed again, and identical content already imported for the same type and period blocked.
- **Suggested type and period, never trusted**: the period is proposed from the month folder name and refined by the dates found in the file; the type from the file name and confirmed by the file's structure. Anything undeterminable is left empty for the person to fill.
- **Import only on explicit confirmation**, for the network-wide sales report and the restocking report. An import that would replace an already-ingested period shows what it replaces and needs a second confirmation. Import reuses the existing pipeline: raw file in object storage, ingestion created, parsing, rejections, idempotent replace and status unchanged.
- **Configurable**: the size limit (default 25 MiB), the schedule, the name patterns and every validation threshold are environment settings with documented defaults.
- **Synthetic data stays out**: files carrying a synthetic marker in their name are tracked as synthetic and cannot be imported; test data lives only in fixtures and fakes.
- **Admin**: a "Arquivos no Drive" section in `/ingestion` with a row per file (validation result and inconsistencies, editable type and period, replace warning, Import and Ignore), "Sincronizar agora" and the last-scan status.

**Out of scope**: importing without a person's confirmation, old per-store sales formats, cost/price sheets, Drive push notifications (polling only), several root folders, per-user OAuth, per-store operating calendars kept in `stores-service`, and deleting or moving anything in the Drive.

## Capabilities

### New Capabilities

- `drive-ingestion-source`: discovering report files in a configured Google Drive folder, validating them without importing, tracking their state, proposing type and period, and importing a confirmed file through the existing ingestion pipeline, including the safeguards that keep an incomplete, duplicated, synthetic or wrong-period file from being imported silently.

### Modified Capabilities

None. The existing `ingestion` requirements (idempotent re-ingestion, observable status, processing off the request path, file type determining the parser) all continue to hold for an ingestion created from Drive, and none of them changes.

## Impact

- **New**: `drive_file` and `drive_scan_run` tables and a migration in `ingestion-worker-service`; a `drive-source` module there (Drive client behind an interface, scan, validate and import queue workers, pure validation checks, controller); three internal queue names (in the worker's own constants, next to `INTERNAL_QUEUES`; `@app/ingestion-contracts` is only for queues that cross services) and the request/response types of the new routes.
- **Modified**: `gateway-service` (new routes under `/drive-files`, no business logic; reuses `ingestion:read` and `ingestion:upload`, so **no IAM migration**); `ingestion-worker-service` environment validation, compose and `.env.example` (all new variables optional); admin `/ingestion` page and an RTK Query slice.
- **New dependency**: `@googleapis/drive` in `ingestion-worker-service` (justified in design.md).
- **Not modified**: the parse and staging pipeline, the `Ingestion` model, `sales-service`, `supply-service`, `finance-service`, `inventory-service`, IAM.
- **Operator prerequisites** (outside the repo): a Google Cloud project with the Drive API enabled, a service account with a JSON key, and the `Vendas x abastecimento` folder shared with that account as a viewer (it lives in My Drive). A Workspace policy that blocks service accounts would block this design; per-user OAuth is the fallback and is out of scope here.
- **Enables**: importing the detailed monthly reports that `add-commercial-intelligence-page` needs in order to validate the quality of `Cupom` and of the history. It is not a dependency of that change, but that change is held until those months are in.
- **Working tree note**: `ingestion-worker-service` and `gateway-service` contain uncommitted work from `add-sales-transaction-detail`. This change is additive to them and stages its own files by explicit path.

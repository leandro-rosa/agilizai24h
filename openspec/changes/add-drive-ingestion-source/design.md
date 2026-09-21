## Context

See `proposal.md` — Why / What Changes for motivation and scope, and `specs/drive-ingestion-source/spec.md` for the behavior contract. This section covers only what the approach builds on, confirmed by reading the code (2026-09-19):

- **Where the files live** (operator, 2026-09-19): `My Drive › agiliz.ai › Vendas x abastecimento › <month> › Relatório_2026`. It is a personal My Drive, not a shared drive. The month folders in the older local copy are named like `março-26`; each also holds the restocking report (`Abastecimentos AAAA-MM-DD _ AAAA-MM-DD.xlsx`) and, for older months, one `venda <client> - <site> <month>.xlsx` per store in the old per-store format. Whether `Relatório_2026` is a file or a folder is still to be confirmed; the design handles both.
- **Manual upload today.** `gateway-service` `POST /ingestions` (multipart; fields `file_type`, `period` required as `YYYY-MM`, `store_id` optional except for cost) enforces `MAX_UPLOAD_BYTES` (default 25 MiB) and `.xlsx/.xls/.csv`, writes the raw file with `S3Service.uploadFile` under `ingestions/{period}/{storeId|network}/{ingestionId}-{filename}`, then calls the worker's `POST /ingestions` with `{id, file_type, object_key, original_name, store_id?, period, correlation_id}`. The worker registers the ingestion and queues parsing; parsing never runs on the request path. The gateway's comments are explicit that the period is required, never inferred.
- **The worker already has what an import needs**: `AwsModule` (`S3Service.uploadFile` / `getFile`), `SheeterModule`, `parse-file.worker.ts` with `isNetworkSalesFile(filePath)` (network format = a `Cliente` column), and a pre-scan of restocking operations that reads each sheet's `Finalizado em` date (`IngestionOperation.finished_at`).
- **`Ingestion`** has no checksum or source columns; it records file type, object key, original name, optional store, period, status (`accepted | processing | completed | partially_completed | failed`), error and chunk counters. Re-ingesting replaces per (store, period) inside the sales/supply sinks.
- **Queues**: BullMQ 5.81 through `@app/hold-it`. `getQueue(name)` exposes the raw `Queue`; `holdIt({queueName, message, options})` enqueues, and hold-it's default job options retain a completed job for 2 hours (`removeOnComplete: { age: 7200, count: 1 }`). There is **no** cron or repeatable-job precedent in the repo and **no** Google client dependency.
- **Timestamps**: `Data/Hora` is the store's local wall-clock time; ingestion stores it as if it were UTC (`toExcelDate`). Day and month are therefore taken from the stored date parts (UTC accessors), never shifted by a time zone.
- **Human-in-the-loop precedent**: treasury's `PendingImport` (staged → confirmed/rejected) with a review screen. Here the staged thing is a *file* plus its validation report, not parsed lines.
- **Admin**: `/ingestion` has an upload card and an ingestion history and already gates the upload form with `useHasPermission("ingestion:upload")`. The admin's React Compiler lint rules forbid ref- or effect-driven polling on derived results; the passing pattern is documented in `frontend/apps/admin/CLAUDE.md` (an effect keyed on a derived boolean that creates a `setInterval` calling `refetch()`).

## Goals / Non-Goals

**Goals:**
- Notice new and changed monthly reports in the Drive and check them without anyone downloading anything, while a person stays in control of every import.
- Reuse the existing ingestion pipeline end to end; the Drive is only a new way to *obtain the file and its metadata*.
- Never replace a period on a guess: an incomplete, duplicated, synthetic, wrong-format or wrong-period file cannot get in silently.

**Non-Goals:**
- Import without confirmation, old per-store sales formats, cost/price sheets, several root folders, per-user OAuth, Drive push notifications, writing to the Drive.
- Per-store operating calendars stored in `stores-service` (the store's normal weekdays are inferred from the file itself; see D7 and Follow-ups).
- Backfill orchestration beyond the list: importing January–August is the operator clicking Importar on each month.
- Changing any parser, sink, event or the `Ingestion` model.

## Decisions

### D1. The connector lives in `ingestion-worker-service`

It owns `Ingestion`, S3 access, the parse queues and Postgres, so an import can call `IngestionService.create` directly. A `drive-source` module adds the Drive client, three queue workers, pure validation functions, a controller and two tables.

*Rejected:* a new `drive-sync-service` (own database, Docker, CI and migrations for ~400 lines, and it would still have to call this worker); an external script or `rclone` posting to the gateway (no staging, validation or confirmation, and the period/type rules would live outside the repo).

### D2. A scan reads metadata; validation reads content into a temporary file and keeps only aggregates

The scan lists files with the fields `id, name, mimeType, size, md5Checksum, modifiedTime, version, parents, trashed`; it never downloads or exports. Validation (D6) does download, because the operator wants the checks visible *before* they decide. The privacy trade-off is deliberate and bounded: the file goes to a temporary path in the worker, only an aggregated report is stored (counts, dates, store names, day masks, format, hash, findings), the temporary file is deleted in a `finally` block, and nothing reaches object storage or `Ingestion`. `Final cartão` and `Número comprador` are never read into the report. Automatic validation can be switched off (`DRIVE_AUTO_VALIDATE=false`), leaving a manual "Validar" action, in which case the Drive content moves only when a person asks.

### D3. Data model: `drive_file` and `drive_scan_run`

`drive_file` (one row per Drive file id):

| Column | Notes |
|---|---|
| `id` (uuid) | primary key |
| `drive_file_id` | unique |
| `name`, `path` | `path` is the folder path from the root, e.g. `agosto-26/Relatório_2026` |
| `mime_type`, `size_bytes?` | native Google Sheets report no size |
| `fingerprint` | `md5Checksum` when present, else `"{modifiedTime}#{version}"` |
| `is_synthetic` | name or path matched the synthetic marker (D16) |
| `suggested_file_type?`, `suggested_period?`, `suggestion_note?` | proposals and their reason (D5) |
| `status` | `new | changed | importing | imported | ignored | missing | error` |
| `error?` | last failure reason |
| `validation_status` | `none | validating | passed | needs_validation | blocked | failed` |
| `validation_report?` (jsonb), `validated_fingerprint?`, `validated_at?`, `content_sha256?` | aggregated report (D6), the fingerprint it was computed on, and the content hash |
| `duplicate_of_id?` | the earlier imported `drive_file` (D8); a plain column, not a foreign key |
| `validation_confirmed_by?`, `validation_confirmed_at?`, `validation_confirmed_sha256?` | the person's review of the inconsistencies, bound to the hash reviewed |
| `import_file_type?`, `import_period?` | the type and period the person confirmed for the import in flight; copied to `imported_*` only on success, so a failed re-import never overwrites what an earlier one recorded |
| `imported_ingestion_id?`, `imported_fingerprint?`, `imported_sha256?`, `imported_file_type?`, `imported_period?` | link to `Ingestion` (a plain column, so the `Ingestion` model stays untouched) and what was imported |
| `confirmed_by?`, `confirmed_at?` | who confirmed the import |
| `first_seen_at`, `last_seen_at`, `updated_at` | |

Transitions: a scan inserts `new`; on a known file, `fingerprint = imported_fingerprint` keeps `imported`, a different one moves `imported`/`ignored` → `changed` (an `ignored` file is re-proposed only when its fingerprint differs from the one ignored) and resets `validation_status` to `none`; absent from the listing → `missing` (and back on reappearance); Import moves `new | changed | error` → `importing` → `imported`, or → `error` on failure. The effective status shown for an `imported` file whose linked `Ingestion` later reaches `failed` is `error` with that ingestion's message, derived at read time by joining `Ingestion`, so the worker does not have to watch ingestions. A retry creates a **new** ingestion; the failed one stays as history.

A unique index over `(imported_sha256, imported_file_type, imported_period)` backs the duplicate rule. Postgres treats NULLs as distinct, so a file that was never imported (all three NULL) never collides, and no partial index is needed, which also avoids a drift between the schema and the database that Prisma cannot express.

`drive_scan_run` records `started_at`, `finished_at`, `trigger` (`schedule | manual`), `outcome` (`ok | failed`), `files_seen`, `skipped_by_pattern`, `new_count`, `changed_count` and `error`; the status endpoint reads the latest, and rows beyond the last 30 are pruned.

### D4. Folder traversal and which files are tracked

Breadth-first from the configured root (the `Vendas x abastecimento` folder), to a depth of 3, paging with `nextPageToken`, with `supportsAllDrives` and `includeItemsFromAllDrives` enabled (harmless for My Drive, needed if the folder ever moves to a shared drive). A *month folder* is a direct child folder of the root. A file is tracked when its own name, or the name of a folder between its month folder and itself, matches one of `DRIVE_INCLUDE_PATTERNS` (default `relat[oó]rio` and `abasteciment`, matched on the accent-stripped, lowercased name), so the tens of legacy `venda …` files are not listed; the skipped count goes into the scan summary. Recorded mime types: `.xlsx`, `.xls`, `.csv` and `application/vnd.google-apps.spreadsheet`. Skipped: trashed items and names starting with `~$`. A file directly under the root (not in a month folder) is tracked with an empty period suggestion.

### D5. Suggestions are pure functions, table-driven, and empty when unsure

- **Period from the path.** Normalise each folder name (lowercase, strip accents). Recognise pt-BR month names and their three-letter forms (`jan fev mar abr mai jun jul ago set out nov dez`), or `MM`, `YYYY-MM`, `MM-YYYY`. Year resolution: a two- or four-digit suffix in the same folder name (`março-26`, `agosto_2026`) wins; otherwise any other folder on the path or the file name that carries a four-digit year (the real report is called `Relatório_2026`, inside a month folder that may carry no year); empty when there is none or when those sources disagree with each other. A name that yields two different months is empty.
- **Type from the name.** `abasteciment*` → supply. `relatorio*` (with no `abasteciment`) → sales, with the note "nome genérico, confirmado pelo conteúdo" because `Relatório_2026` does not say what it is; when the file's own name says nothing, a folder on its path (a report folder) is read the same way. Both or neither → empty.
- **Cross-check.** A restocking file named like `Abastecimentos 2026-07-01 _ 2026-07-31.xlsx` carries its own month; if it differs from the folder's month, the suggestion is empty with the note `conflict`.
- **Content refines.** After validation (D6) the dominant month and the detected format replace an empty suggestion (noted "derivada do conteúdo") and flag a conflict with the folder; the type detected from the structure always wins over the name.

### D6. Validation is a queue job that produces an aggregated report

`DRIVE_VALIDATE` runs (concurrency 1) for every `new` or `changed` tracked file when `DRIVE_AUTO_VALIDATE` is on, and on `POST /drive-files/:id/validate`. It:

1. Refuses a file whose `size_bytes` exceeds `DRIVE_MAX_FILE_BYTES` before downloading and enforces the cap while streaming.
2. Downloads (`alt=media`) or, for a native Google Sheet, exports to xlsx (Drive caps exports at 10 MB) into a temporary file, computing SHA-256 while streaming.
3. Detects the format with the worker's own readers (no second implementation): the restocking layout via `locateRestockingOperations` first (a restocking sheet also carries a `Cliente` column, so only its operation blocks tell it apart), then network sales by the same header row and required columns `ParseFileWorker` enforces (`locateRawHeaderRow` plus client store, product, quantity and result), then the old per-store layout (named as such and never imported), otherwise `unknown`.
4. Builds the aggregated report: format; `row_count`; a histogram of dated rows by month; for sales, per month and per store the row count and a day mask (which days of the month have at least one row, any result); for restocking the histogram of operation finish dates; store names as they appear; no PII.
5. Evaluates the checks of D7 against the effective type and period and stores `validation_status`, the report, `validated_fingerprint`, `content_sha256` and the thresholds applied.
6. Deletes the temporary file in `finally`; a start-up sweep removes leftovers from a crashed process.

Because the report keeps the day masks and month histogram, changing the period or type in the UI can be **re-evaluated from the stored report** without downloading again when the fingerprint is unchanged; `POST /drive-files/:id/validate` does that and re-downloads only when the file changed.

### D7. The checks, their formulas and their thresholds

All thresholds are settings with defaults (D13); every report states the values it used. Days and months come from the stored wall-clock date parts. `today` is the date in America/Sao_Paulo.

**Blocking checks** (`validation_status = blocked`, Import unavailable until fixed and revalidated):

| Check | Definition | Blocks when |
|---|---|---|
| Format | detected format vs the stated type (sales must be the network format; an old per-store report is named as such) | mismatch or `unknown` |
| Period identity | `share = dated rows in the selected month ÷ all dated rows` (any result; for restocking, operations finished in the month ÷ all operations) | `share <` `DRIVE_PERIOD_MATCH_MIN_SHARE` (0.90), naming the dominant observed month; or no readable dates |
| Size | `size` vs `DRIVE_MAX_FILE_BYTES` | over the limit |
| Duplicate | `content_sha256` equals an `imported_sha256` with the same type and period (D8) | duplicate, naming the earlier import |
| Synthetic | marker in the name or path (D16) | matched |

**Coverage checks** (sales only; `validation_status = needs_validation`, Import needs the person's confirmation, D9). Restocking has no daily grain, so it gets identity only.

1. *Month window.* `start` = first day of the selected month; `end` = last day of the month, or `today` if the month is still in progress.
2. *Edges.* Let `firstDay` and `lastDay` be the earliest and latest dated rows of the file. Inconsistency `edge_start` if `firstDay > start + DRIVE_EDGE_TOLERANCE_DAYS` (3); `edge_end` if `lastDay < end − DRIVE_EDGE_TOLERANCE_DAYS`. This is the guard against a file cut short, which the per-store inference below cannot see on its own.
3. *A store's normal weekdays.* For each weekday `w`, let `occ(w)` be the number of days in `[start, end]` that fall on `w`, and `hit(w)` the number of those days on which the store has at least one row (any result). `w` is normal for the store when `hit(w) ÷ occ(w) ≥ DRIVE_WEEKDAY_OPEN_MIN_SHARE` (0.50).
4. *Expected operating days.* `E(store)` = the days in `[start, end]` whose weekday is normal for the store. `C(store)` = the days in `E(store)` with at least one row. `coverage(store) = C ÷ E`.
5. *Not verifiable.* If the store has fewer than 2 normal weekdays or `|E| < 8`, its coverage is reported as not verifiable.
6. *File coverage* = `Σ C ÷ Σ E` over the stores whose coverage is verifiable (pooled, not an average of percentages).
7. Inconsistency `low_file_coverage` if the file coverage `<` `DRIVE_COVERAGE_MIN_POOLED` (0.90); `low_store_coverage` for each store with coverage `<` `DRIVE_COVERAGE_MIN_STORE` (0.70), listing up to ten missing dates; `store_not_verifiable` for each store under 5.

Hand-computed fixtures (August 2026 begins on a Saturday and has 31 days: Sat, Sun and Mon occur 5 times, the other weekdays 4 times):
- A store with rows on every Mon–Fri and none on Sat/Sun: `occ(Sat)=occ(Sun)=5` with `hit=0`, so both are not normal; `E` = 5+4+4+4+4 = 21, `C` = 21, coverage 100%.
- The same store with no rows on 10–21 August: Mon (3, 24, 31 → 3 of 5 = 60%), Tue (4, 25 → 2 of 4 = 50%), Wed, Thu and Fri likewise 50%, so all five stay normal; `E` = 21, `C` = 11, coverage 52.4%, below 70%, so `low_store_coverage`.
- The same store with no rows on 10–28 August: every weekday drops below 50% (Mon 2 of 5 = 40%, the others 1 of 4 = 25%), no normal weekday remains, so `not_verifiable`.
- A file whose last row is on 15 August: `lastDay=15 < 31−3=28`, so `edge_end`.

*Known limits, stated in the UI and the report:* the normal weekdays are inferred from the file itself (no operating calendar exists in `stores-service` yet; `opened_on` and `headcount` are null), so a file cut short is caught by the edge check rather than by store coverage; a public holiday with no sales counts as an expected day, which the file-level 0.90 absorbs; a store that opens mid-month shows low coverage and the person validates it once.

*Rejected:* coverage on calendar days (penalises every store that legitimately does not sell on weekends); learning the weekdays from previously imported months (the worker would have to read `sales-service`, breaking database-per-service, and the first import has no history); a fixed Monday–Friday calendar (wrong for the sites that open on weekends).

### D8. Duplicate prevention in layers

1. **Identity**: one `drive_file` row per Drive file id (unique).
2. **Concurrency**: the atomic status guard of D9 (`UPDATE … WHERE status IN (…)`; zero rows → HTTP 409).
3. **Unchanged**: a file whose fingerprint equals `imported_fingerprint` is never proposed again.
4. **Content**: at validation and again at import, `content_sha256` is compared with the `imported_sha256` of every imported file with the same type and period; a match sets `duplicate_of_id`, `validation_status = blocked` and names the earlier import; the unique index of D3 makes the database refuse it even if two imports race.

A corrected file has a different hash, so it is a replacement, not a duplicate. **Limits:** a native Google Sheet is exported to xlsx and its bytes may differ between exports even when nothing changed, so for Sheets the hash is best-effort and the fingerprint is the fallback; a manual upload made earlier through `/ingestion` stores no hash, so an identical earlier manual upload is not detected as a duplicate (the replace warning of D10 still applies).

### D9. Import runs as a queue job with guarded state

`POST` import validates the request, atomically moves the file `new | changed | error` → `importing` with a conditional `UPDATE` (zero rows → 409), enqueues `DRIVE_IMPORT` and returns 202. It requires: `file_type` and `period` confirmed by the person; `confirm_replace: true` when `would_replace` is set (D10); and, when the file's validation result is `needs_validation`, `confirm_validation: { content_sha256 }` carrying the hash the person reviewed. The job:

1. Re-downloads into a temporary file (same size cap), computes the SHA-256 and recomputes every check of D7 for the confirmed type and period.
2. Refuses if any blocking check fails (including a duplicate), if `needs_validation` and the confirmed hash is missing or differs from the downloaded hash, or if the content changed so that the reviewed report no longer applies; nothing has been written yet.
3. Uploads the raw file to `ingestions/{period}/network/{ingestionId}-{name}` and calls `IngestionService.create({ id, fileType, objectKey, originalName, period, correlationId })` with no `storeId`.
4. Records `imported_ingestion_id`, `imported_fingerprint`, `imported_sha256`, `imported_file_type`, `imported_period`, `status = imported`, and `confirmed_by`/`confirmed_at` (and `validation_confirmed_*` when applicable); on any failure records `status = error` and the reason.
5. Always deletes the temporary file.

Nothing reaches S3 or `Ingestion` before the checks pass, so a refused import leaves no trace besides the file's `error`. The validation confirmation cannot be reused after the file changes, because it is bound to the reviewed hash.

### D10. Replace detection is conservative

`would_replace` is the latest `Ingestion` of the same `file_type` and `period` with status `completed` or `partially_completed`, including the one this same file produced earlier when the file is `changed`. Replacement in the sinks is per (store, period), so a network file replaces the stores it contains; flagging any completed ingestion of that type and period over-warns rather than under-warns, and the import requires `confirm_replace: true` when it is set.

### D11. Scheduling and queues through BullMQ

Three internal queues, `DRIVE_SCAN`, `DRIVE_VALIDATE` and `DRIVE_IMPORT`, defined in the worker's own constants (the `INTERNAL_QUEUES` precedent; `@app/ingestion-contracts` holds only queues that cross services) and added to `REGISTERED_QUEUES`, whose spec guards against a queue that is published to but never registered. At bootstrap, **only when configured**, the worker calls `queue.upsertJobScheduler('drive-scan', { pattern: DRIVE_SCAN_CRON, tz: 'America/Sao_Paulo' }, { name: 'scan', data: { trigger: 'schedule' } })` (default `0 6 * * *`); it is idempotent, so restarts and replicas never duplicate it. When **not** configured it calls `removeJobScheduler('drive-scan')`, so unsetting the variables really stops scans. "Sincronizar agora" enqueues a manual scan (which then enqueues validations for new and changed files) after checking the queue for a waiting or active scan job. It does **not** use a fixed `jobId`: hold-it retains a completed job for two hours and BullMQ ignores a job added under an id it still retains, which would silently block manual syncs for two hours.

*Rejected:* `@nestjs/schedule` (a new dependency that fires in every replica); an external cron calling an endpoint (infrastructure outside the repo).

### D12. HTTP contract

Worker (`@Controller('drive-files')`): `GET /drive-files?status=`, `GET /drive-files/status`, `POST /drive-files/scan` (202), `POST /drive-files/:id/validate` (200 with the result when the file's aggregates are already stored, so a change of type or period is answered at once with no download; 202 when it queued the work), `POST /drive-files/:id/import` (202), and `POST /drive-files/:id/ignore` with `{ ignored?: boolean }`, where `ignored: false` restores a file as `new` or, if an earlier version was imported, `changed`. The gateway mirrors them under the top-level path `/drive-files` (not `/ingestions/drive-files`, which would collide with the gateway's `GET /ingestions/:id`); it holds no logic, declares `@RequiresPermission(INGESTION_READ)` on the two reads and `INGESTION_UPLOAD` on scan, validate, import and ignore, and forwards the session identity as `confirmed_by` (which overrides anything a browser sends). No new permission, so no IAM migration. Every refusal of the worker carries a stable `code` and its details (`replace_confirmation_required` with `would_replace`; `validation_confirmation_required` with the inconsistencies and the hash to confirm; `blocked` with the findings; `not_importable`, `synthetic_file`, `invalid_period`, `not_configured`…). The gateway's shared upstream filter forwards only a status and a message and would drop them, so this controller relays the worker's error body itself rather than changing a filter every route shares; extending the shared filter is a possible follow-up.

List item: `id, name, path, mime_type, size_bytes, status, error, is_synthetic, suggested_file_type, suggested_period, suggestion_note, validation_status, validation: <the stored report, as is, camelCase: version, outcome, format, fileType, period, rowCount, sizeBytes, contentSha256, monthHistogram, dominantMonth, periodShare, firstDay, lastDay, fileCoverage, stores: [{ name, rows, normalWeekdays, expectedDays, coveredDays, coverage, verifiable, missingDates }], blocking: [{ code, message, details }], inconsistencies: [{ code, message, details }], thresholds — never the day masks or any row> | null, duplicate_of: { id, path, imported_at } | null, would_replace: { ingestion_id, ingested_at, status } | null, imported_ingestion_id, confirmed_by, confirmed_at, validation_confirmed_by, validation_confirmed_at, last_seen_at`. Import body: `{ file_type: 'sales' | 'supply', period: 'YYYY-MM', confirm_replace?: boolean, confirm_validation?: { content_sha256: string } }`, response 202 `{ id, status: 'importing' }`; the resulting ingestion is followed through the existing `GET /ingestions/:id`.

### D13. Configuration and the new dependency

All optional; the feature is dormant until the first three are set.

| Variable | Default | Meaning |
|---|---|---|
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | — | the `Vendas x abastecimento` folder |
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` or `GOOGLE_SERVICE_ACCOUNT_FILE` | — | the credential |
| `DRIVE_SCAN_CRON` | `0 6 * * *` | scan schedule, time zone fixed to America/Sao_Paulo |
| `DRIVE_AUTO_VALIDATE` | `true` | validate new/changed files after a scan |
| `DRIVE_MAX_FILE_BYTES` | `26214400` (25 MiB) | size limit |
| `DRIVE_INCLUDE_PATTERNS` | `relat[oó]rio,abasteciment` | which names are tracked |
| `DRIVE_SYNTHETIC_PATTERN` | `sint[eé]tic|synthetic|\[teste\]` | files refused as synthetic |
| `DRIVE_PERIOD_MATCH_MIN_SHARE` | `0.90` | period identity |
| `DRIVE_WEEKDAY_OPEN_MIN_SHARE` | `0.50` | normal-weekday rule |
| `DRIVE_COVERAGE_MIN_POOLED` | `0.90` | file coverage minimum |
| `DRIVE_COVERAGE_MIN_STORE` | `0.70` | store coverage minimum |
| `DRIVE_EDGE_TOLERANCE_DAYS` | `3` | edge tolerance |

Validation requires the folder id and a credential together or neither. The key is never logged and never appears in any response or DTO; `.env.example` documents the names only. Read-only scope `https://www.googleapis.com/auth/drive.readonly` with a service account, which sees only what is shared with it. New dependency `@googleapis/drive` (which brings `google-auth-library`) in `ingestion-worker-service`. *Rejected:* the full `googleapis` package (the whole Google SDK for one API); hand-rolled JWT signing over `@app/http-client` (security-sensitive code we would own).

### D14. Drive access sits behind an interface

`DriveClient { listFolder(folderId): AsyncIterable<DriveItem>; download(fileId, destPath, maxBytes): Promise<{ sha256 }>; exportSheet(fileId, destPath, maxBytes): Promise<{ sha256 }> }` with the Google implementation and an in-memory fake. Scan, validation, import and suggestion logic are tested against the fake; CI never talks to Google.

### D15. Admin UI

A `DriveFilesSection` (its own `memo` component) in `/ingestion`, a `driveFiles` group of endpoints added to the existing ingestion slice. Rows: path/name, status `StatusBadge`, validation badge (Validado / Requer validação / Bloqueado / Duplicado / Sintético) with the inconsistencies expandable, a file-type select and a month input pre-filled from the suggestions and editable per row, the replace warning, and Importar / Ignorar. Importar stays disabled until type and period are valid and for blocked, duplicate and synthetic files; for `needs_validation` it opens a `Dialog` listing each inconsistency (store, coverage, missing dates) with a checkbox "Revisei as inconsistências e confirmo a importação", and a replace opens the same dialog listing the ingestion to be replaced. The header shows the last scan (time, outcome, error) and "Sincronizar agora". While a scan, a validation or an import is in progress the section refetches on an interval using the effect-keyed-on-a-derived-boolean pattern that passes the admin's lint rules. Everything goes through `RequestState`. Without `ingestion:upload` the actions are absent (`useHasPermission`); when the status says "not configured" the section shows "Drive não configurado" and nothing else.

### D16. Synthetic data policy

Synthetic or test data is never written to the real databases and never enters real analyses. Tests use in-memory fixtures and the fake `DriveClient`; the end-to-end acceptance uses only the operator's real files. Any test spreadsheet placed in the Drive must carry the synthetic marker (`DRIVE_SYNTHETIC_PATTERN`) in its name or folder; such a file is tracked as `is_synthetic`, visibly labelled, and refused at validation and again at import, so it cannot reach `Ingestion` or the domain services even by mistake. A live run that needs a database uses a throwaway stack (separate compose project and volumes), not the operator's running one.

### D17. Testing and rollout

The repository's three tiers: unit tests for the suggestion tables (accents, case, `-26`, `2026-08`, conflicts), the coverage functions with the hand-computed fixtures of D7, the status transitions, the duplicate rules and the replace detection; integration tests for scan, validation and import against the fake `DriveClient` with the worker's real database and queue setup; no live Google in CI. Live acceptance needs the operator's service account and folder. The migration only adds two tables (with one plain unique index, see D3); the feature is dormant until configured; rollback is unsetting the variables (the scheduler is removed on the next boot) and the tables can stay.

## Risks / Trade-offs

- **Automatic validation moves file content out of the Drive before a person confirms** → bounded by D2 (temporary file, aggregated report only, no PII stored, no S3, no `Ingestion`) and switchable with `DRIVE_AUTO_VALIDATE=false`.
- **Workspace policy may block service accounts or external sharing** → this design cannot work as written; per-user OAuth is the fallback and is a separate change.
- **Normal weekdays are inferred from the file** → a file cut short is caught by the edge check, not by store coverage; a holiday counts as an expected day; a store opened mid-month is flagged once. These are stated in the report and are why a person validates.
- **Native Google Sheets converted to xlsx may format dates differently, and their bytes differ between exports** → the period check blocks unreadable dates instead of guessing; the duplicate hash is best-effort for Sheets (D8); verify with a real file at acceptance.
- **Sheets have no md5** → the fingerprint uses modified time and version, so a touch without a content change shows as `changed`; a person confirms anyway.
- **Folder naming drift** → suggestions go empty or come from the content; nothing is guessed.
- **`would_replace` over-warns** (D10) → accepted; the safe direction.
- **Sensitive data on disk during validation and import** → temporary file per job, always removed, start-up sweep for crashes.
- **Drive listing is eventually consistent** → a file uploaded seconds before a scan may show up on the next one; harmless.
- **Dirty working tree** → `ingestion-worker-service` and `gateway-service` contain uncommitted `add-sales-transaction-detail` work, including `app.module.ts`. This change is additive but must touch `ingestion.module.ts`, `app.module.ts` and the env files; commits stage explicit paths.
- **A person can still confirm a wrongly typed file** whose contents happen to match its selected month; the format check (which the structure decides, not the name) and the period identity check are the guards and the confirmation is the last one.

## Follow-ups

- Per-store operating calendars in `stores-service` to replace the inferred weekdays; auto-import of files that pass every check, once trust is established (explicitly not now); Drive push notifications instead of polling; per-user OAuth; cost/price sheets; a backfill helper that proposes all months at once; recording a content hash on manual uploads so they take part in duplicate detection.

## Open Questions

- Whether `Relatório_2026` is a file or a folder inside each month folder (D4 supports both), and whether any files sit directly under the root.
- The default scan time (06:00 America/Sao_Paulo) is fixed by the operator; only the cron pattern is configurable.
- Whether 0.90 / 0.70 / 3 days / 0.50 suit the real reports; they are provisional defaults to calibrate with the first real months (each report states what it used).

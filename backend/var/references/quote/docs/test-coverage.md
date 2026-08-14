# apps/quote — Test Coverage Matrix

Layer-by-layer mapping of production files to their tests, as of the
"Fase 16" testing pass. This is a point-in-time snapshot, not an
architectural contract — update it as tests are added or modules change.
The durable testing philosophy behind it lives in `../CLAUDE.md`.

| Layer | Production file | Test(s) | What it verifies |
| --- | --- | --- | --- |
| Env | `src/config/env.validation.ts` | `env.validation.spec.ts` (unit) | required service values plus matching-worker concurrency defaults and 1..20 bounds |
| Job contract | `modules/quotes/jobs/quote-job-envelope.ts` | `quote-job-envelope.spec.ts` (unit) | `createQuoteJobEnvelope` assembles `schemaVersion`/`quoteId`/`emittedAt` and survives a JSON round-trip |
| Repository | `modules/db-client/repository/quote.repository.ts` | `quote.repository.integration-spec.ts` (integration, real Postgres) | `create` + `findUnique` with a related `QuoteItem`, against the real migrated schema |
| Service | `modules/quotes/services/quotes.service.ts` | `quotes.service.spec.ts` (unit, `QuoteRepository` mocked) | `status` defaults to `draft`; quote detail excludes unbounded items; `NotFoundException` when the repository returns `null` |
| Matching config | `modules/quotes/utils/matching-config.util.ts`, `modules/quotes/dto/matching-config.dto.ts`, `modules/quotes/services/quotes.service.ts` | `matching-config.dto.spec.ts`, `quotes.service.spec.ts`, `quotes.controller.spec.ts` (unit) | typed defaults/bounds; atomic revision/activity writes; old-revision pending reset; same-revision retry-safe enqueue; counter recomputation; bounded fan-out |
| Controller | `modules/quotes/controllers/quotes.controller.ts` | `quotes.controller.spec.ts` (unit, services mocked) | route delegation, including cursor query forwarding for activity |
| Service | `modules/quotes/services/partner-intake.service.ts` | `partner-intake.service.spec.ts` (unit, repositories/Prisma transaction mocked) | partner validation; atomic `total_rows` increment supplies `row_number`; no item-count scans; asynchronous match enqueue preserved |
| Service | `modules/quotes/services/quote-activity.service.ts` | `quote-activity.service.spec.ts` (unit, repository mocked) | newest-first cursor pagination envelope and default page size |
| Worker | `modules/quotes/jobs/search-match-result.worker.ts` | `search-match-result.worker.spec.ts` (unit, Prisma transaction mocked) + `search-match-result.worker.integration-spec.ts` (integration, real Postgres + Redis) | v1/revision-zero compatibility; v2 config/evidence scoring; minimum score; stale no-op; conditional auto-approval; atomic counters/status/activity; retry idempotency |
| Producers | `modules/quotes/jobs/{process-upload,match-item}.producer.ts` | `*.producer.spec.ts` (unit, `HoldItBullMQBroker` mocked) + `producers.integration-spec.ts` (integration, real Redis) | unit: envelope and `options` (idempotent `jobId`, `attempts`, `backoff`) passed to the broker; integration: the job actually reaches the BullMQ queue and doesn't duplicate on the same `quoteId`/step |
| Workers | `modules/quotes/jobs/{process-upload,match-item}.worker.ts` | `*.worker.spec.ts` (unit, fake `Job`) + `workers.integration-spec.ts` (integration, real Redis) | schema guard; spreadsheet mapping/normalization; partner canonical preparation; version-2 real-catalog delegation; queue completion |
| App boot | `app.module.ts` + `@app/health` | `test/health.e2e-spec.ts` (e2e) | the Nest app actually boots and `GET /health` responds |
| Service | `modules/quotes/services/search-catalog.service.ts` | `search-catalog.service.spec.ts` (unit, `AxiosHttpClient` mocked) | dedupes/chunks ids at `MAX_BULK_PRODUCT_IDS`, merges across chunks, omits (never throws on) a failed chunk, always passes an explicit timeout |
| Util | `modules/quotes/utils/export-field-extraction.util.ts` | `export-field-extraction.util.spec.ts` (unit) | every `PRODUCT_EXPORT_FIELDS` entry extracts its value correctly (EAN join, stock sum, first gallery image, capped `search_application`), unrecognized field and empty product handled |
| Worker | `modules/quotes/jobs/generate-export.worker.ts` | `generate-export.worker.spec.ts` (unit, repositories/`S3Service`/`SearchCatalogService` mocked) + `generate-export.worker.integration-spec.ts` (integration, real Postgres + Redis + S3, `AxiosHttpClient` doubled) | unit: `buildExportRow`/`rawInputToRow` field composition and snapshot fallback, schemaVersion guard, catalog fetch skipped when no selected field needs it, failure marks the export `failed`; integration: queue → worker → real S3 upload → `completed`, downloaded XLSX content matches selected fields, catalog-fetch failure still completes via the snapshot fallback, unsupported `schemaVersion` ends up `failed` |
| Constants guard | `../search/src/modules/products/constants/product-bundle.constants.ts` | `product-bundle.constants.spec.ts` (unit) | every `PRODUCT_EXPORT_FIELDS.sourceField` (`@app/quote-search-match`) is a member of `PRODUCT_BUNDLE_SOURCE_ALLOWLIST` — guards the two lists from drifting apart |

Search relevance acceptance cases and metrics are documented in
`backend/apps/search/docs/relevance-evaluation.md`.

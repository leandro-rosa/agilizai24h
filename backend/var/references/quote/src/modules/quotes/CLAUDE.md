# apps/quote/src/modules/quotes

Owns the quotation business lifecycle end to end: intake, catalog
matching, human review, export, and audit. This is the one module that
turns the persistence primitives in `db-client` and the broker primitives
in `common/nest-libs/hold-it` into the actual product behavior described
in the parent `backend/apps/quote/CLAUDE.md`'s resolved decisions — read
that file first for the *why* behind the rules below; this file is the
*what*.

## API surface (`/quotes`), grouped by business capability

- **Catalog/config**: `GET /config` (frontend-facing config), `GET
  /products/search`, `GET /products` — search/list against the demo
  catalog (see `product-catalog-seed`).
- **Intake**: `POST /` (spreadsheet upload, creates a `Quote` with
  `source: spreadsheet`), `POST /partner-intake` (creates a `Quote` with
  `source: partner_api` from one or more raw-field lines — no
  pre-computed candidates), `POST /:id/items` (adds one more raw-field
  line to an existing `partner_api` quote; 400 on a `spreadsheet` quote).
  Both partner-API endpoints match asynchronously — see Jobs below.
- **Listing/detail**: `GET /`, `GET /:id` (quote header/config only; items
  are available through the paginated item endpoint), `GET /:id/status`,
  `GET /:id/file` (the original uploaded file).
- **Column mapping & processing**: `PATCH /:id/mapping` (submit/confirm
  the spreadsheet column mapping), `POST /:id/start` (kick off matching
  for a mapped quote).
- **Matching configuration**: `PATCH /:id/matching-config` stores a complete
  validated per-quote snapshot and increments its revision; `POST
  /:id/reprocess-pending` atomically resets only pending items from an older
  revision, recomputes counters, then enqueues current-revision preparation
  jobs in bounded chunks. Repeating same revision re-enqueues only items still
  pending without clearing completed machine results.
- **Review**: `GET /:id/items`, `PATCH /:id/items/:itemId/decision`
  (single-item reviewer decision), `POST /:id/items/decisions:batch`
  (bulk decision), `POST /:id/complete` (close out the review session).
- **Export**: `POST /:id/exports` (triggers async generation), `GET
  /:id/exports`, `GET /:id/exports/:exportId`, `GET
  /:id/exports/:exportId/file`.
- **Audit**: `GET /:id/activity` — cursor-paginated `QuoteActivityEvent`
  trail, newest first.

### HTTP and persistence contract

- Quote-owned JSON payload, query, response-entity, and envelope fields use
  snake_case: for example `created_by`, `page_size`, `match_status`,
  `pending_only`, `selected_candidate_id`, `item_ids`, `selected_fields`, and
  `custom_attribute_fields`. Partner-intake request bodies intentionally remain
  camelCase: `POST /partner-intake` uses `displayName`, `partnerName`,
  `externalId`, and `lines[].originalFields`; `POST /:id/items` reuses that
  camelCase raw-line shape. Nested catalog candidate snapshots also retain their
  catalog shape (`productId`, etc.), not quote-entity naming.
- `:id`, `:itemId`, and `:exportId` are integer path values. Persisted quote
  entity IDs and foreign keys (`id`, `quote_id`, `column_mapping_id`) serialize
  as numbers. Catalog product identifiers, including `productId` and persisted
  `selected_candidate_id`, remain strings; never conflate catalog IDs with quote
  entity IDs.
- `GET /`, `GET /:id/items`, and `GET /:id/activity` accept integer `cursor`
  plus `page_size` (default 20, maximum 100) and return
  `{ items, next_cursor, page_size }`; `next_cursor` is the last entity's
  integer ID or `null`.
- Persisted field references follow Prisma's snake_case names, including
  `selected_sheet`, `header_row`, `raw_input`, `normalized_data`,
  `match_status`, `review_status`, `review_decision`, `selected_fields`, and
  `custom_attribute_fields`.

## Jobs (via `HoldItModule`, BullMQ)

Internal queue fields remain camelCase. Cross-service consumers accept queued
`schemaVersion: 1` jobs at revision zero and revision-aware `schemaVersion: 2`
jobs. Version-2 request/result job IDs include quote, item, and revision.

- **process-upload**: enqueued on spreadsheet intake. Worker fetches the
  file from S3 and parses it into `QuoteItem` rows, auto-detecting sheet/
  header row (re-parsing on a later manual mapping override via `PATCH
  :id/mapping` is not implemented — see the parent CLAUDE.md).
- **match-item**: enqueued per item after `POST /:id/start`. Worker
  prepares both origins for real-catalog matching. Spreadsheet items apply
  column mapping and normalization; partner items use canonical raw fields.
  It stores normalized data and publishes a version-2 search request.
- **generate-export**: enqueued on `POST /:id/exports`. Worker fetches each
  item's matched product fresh from `apps/search` (via `SearchCatalogService`,
  batched by `productId`), extracts only the fields the export's
  persisted `selected_fields` asked for (`extractProductExportValue`), plus
  persisted `custom_attribute_fields`, and falls back to the item's stored
  candidate snapshot if that fetch fails — never failing the whole export over
  one unreachable/failed lookup. Unit-tested
  (`generate-export.worker.spec.ts`, `export-field-extraction.util.spec.ts`)
  and integration-tested against real Postgres/Redis/S3 with the one
  outbound HTTP call doubled (`generate-export.worker.integration-spec.ts`)
  — see `openspec/changes/quote-item-redecision-and-export-config/design.md`.
- **search-match-request / search-match-result**: a cross-service pair, not
  a same-app producer/worker pair like the three above.
  `SearchMatchRequestProducer` enqueues `SEARCH_MATCH_REQUEST_QUEUE`
  (`@app/quote-search-match`) per partner-API item on `POST
  /partner-intake` and `POST /:id/items` — consumed by `apps/search`'s
  `ProductMatchWorker`, which queries the real product-bundle catalog and
  publishes candidates on `SEARCH_MATCH_RESULT_QUEUE`.
  `SearchMatchResultWorker` (this app) consumes that, scores each candidate
  with `scoreCandidate()` using revision fields, config, and safe evidence;
  applies minimum score and configured auto-approval; and conditionally writes
  only active revision. Stale results are no-ops and reviewed decisions remain
  unchanged. `MatchItemWorker` and `SearchMatchResultWorker` concurrency each
  default to 10 and are bounded at 20. Requires both apps to share the
  same Redis — see the repository-root `docker-compose.redis.yaml`. Full
  design: `openspec/changes/quote-partner-api-matching/design.md` (or,
  once archived, `openspec/specs/quote-search-matching/spec.md`).

  `SEARCH_MATCH_V2_ENABLED=false` downgrades revision-zero requests to v1 for
  staged rollout. It rejects nonzero revisions because silently dropping their
  configuration would apply incorrect scoring. Rollback after quote matching
  revisions exist must keep v2 consumers available until queues drain or pause
  matching while v2 is disabled.

Both origins match asynchronously through `match-item` preparation and the
same cross-service real-catalog request/result path. Demo index is no longer
an automatic matching authority.

## Services

- **`QuotesService`** — core lifecycle: create from upload, list/get,
  status, file retrieval, mapping submission, start/complete.
- **`QuoteItemsService`** — item listing and single/batch review decisions
  (`decideItem`/`decideItemsBatch`) — identical for every quote source;
  `recalculateReviewProgress` shares `utils/quote-progress.util.ts`'s
  status-transition rule with `SearchMatchResultWorker`'s own progress
  update, so a quote reaches `reviewed` the same way whether its last item
  was reviewed manually or auto-accepted.
- **`QuoteExportsService`** — export creation, listing, file retrieval;
  triggers `GenerateExportProducer`.
- **`PartnerIntakeService`** — partner-API quote creation (`intake`) and
  item addition (`addItem`): validates each line has at least one
  recognized identifying field, creates `pending` `QuoteItem`s, and
  enqueues `MatchItemProducer` per item — no scoring happens here
  anymore (see Jobs above). Incremental additions atomically increment
  `Quote.total_rows`; returned value becomes unique `row_number`, avoiding
  per-item `COUNT(*)` and concurrent-addition races.
- **`QuoteActivityService`** and **`QuoteProductsService`** — wrapped in
  their own `@Global()` module (`quote-shared.module.ts`) rather than
  being plain `QuotesModule` providers, because `HoldItModule.registerWorker`
  registers workers outside `QuotesModule`'s own injector — a worker can
  only inject providers that are global. Both are consumed by workers
  (audit logging, catalog matching) as well as by controller-facing
  services.

For the current test-file mapping, see
`backend/apps/quote/docs/test-coverage.md`.

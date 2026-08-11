# common/nest-libs/quote-search-match

Contract-only package: queue name constants, payload TypeScript
interfaces, and a curated product-field catalog meant to be shared between
a future quote app and a future search app. No NestJS module, no logic, no
runtime dependency — the intent is for both apps to import it so the
request/result job shapes (and the export field catalog) can't silently
drift between two separately-deployed packages the way hand-copied
lists/interfaces would. **Neither app exists under `backend/apps` in this
repo yet** — this lib documents the contract they're designed to share.

## What's here

- `SEARCH_MATCH_REQUEST_QUEUE` — quote-side producer, search-side worker
  consumer.
- `SEARCH_MATCH_RESULT_QUEUE` — search-side producer, quote-side worker
  consumer.
- `SearchMatchJobEnvelope<T>` / `createSearchMatchJobEnvelope` — versioned
  envelope wrapping every job on either queue, mirroring (but independent
  from) the quote app's own internal job envelope. Both envelope contracts
  intentionally remain camelCase with schema version 1:
  `{ schemaVersion: 1, quoteId, emittedAt, payload }`; `quoteId` is a number.
- `SearchMatchRequestPayload` — one quote item's identifying fields
  (`{ itemId, searchFields }`, with numeric `itemId`; `SearchMatchField[]`
  keeps the camelCase `{ targetField, value, priority }` shape the quote
  side's candidate-scoring logic is meant to score against).
- `SearchMatchResultPayload` — up to a handful of `SearchMatchCandidate`s
  the search side found, in camelCase `{ itemId, candidates }`, with
  numeric `itemId`, deliberately narrower than the quote side's own
  candidate DTO (no OEM codes/trade numbers — the real catalog's public
  API doesn't expose `identifiers`, for security) and with no
  score/reasons (scoring stays on the quote side).
- `PRODUCT_EXPORT_FIELDS` — the configurable catalog of fields a reviewer
  can include in a generated quote export, each entry's `sourceField`
  meant to be a top-level field on the search side's product-bundle
  source allowlist. **Never add an entry whose `sourceField` isn't
  already on that allowlist** — this is how "configure export fields from
  the real Elasticsearch mapping" is implemented safely: a hand-curated,
  security-reviewed subset of an already-approved allowlist, not a
  runtime `_mapping` call or an endpoint accepting arbitrary field names.
- `FetchedCatalogProduct` — the minimal shape a quote-side export worker
  would read from a `GET {SEARCH_API_URL}/v1/products?ids=...` response
  (fetched fresh at export time, not the match-time snapshot) — the
  fields `PRODUCT_EXPORT_FIELDS` extracts, plus `mapped_attributes`
  (typed via `FetchedCatalogMappedAttribute`) for reviewer-typed custom
  attribute columns. Those mapped-attribute keys can't be hand-curated the
  way `PRODUCT_EXPORT_FIELDS` is, since they're reviewer-defined rather
  than a fixed catalog.

Queue camelCase is independent from quote HTTP and persistence naming: quote
API/entity fields are meant to use snake_case, including persisted export
`selected_fields` and `custom_attribute_fields`; internal catalog metadata
such as `sourceField` and queue payload fields are not persisted quote
fields and remain camelCase. Catalog candidates omit OEM codes/trade
numbers because the real catalog's public allowlist excludes `identifiers`.

Both queues are meant to be registered via `@app/hold-it`'s
`HoldItModule.register([...])` in each app, and require both apps to point
at the same Redis instance. `PRODUCT_EXPORT_FIELDS`/`FetchedCatalogProduct`
are unrelated to the queue pair — they'd be read over a quote-to-search
HTTP call (`SEARCH_API_URL`, `@app/http-client`), not BullMQ.

Design rationale (matching flow via a partner API, and the export field
catalog + HTTP wiring) predates this repo and isn't present here — treat
the shapes above as the source of truth for the intended contract.

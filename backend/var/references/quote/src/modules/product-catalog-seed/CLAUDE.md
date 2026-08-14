# apps/quote/src/modules/product-catalog-seed

This is a static demo/seed catalog subset for the quote module's matching
demo. It is not synced with the real external catalog — the `product-bundle`
Elasticsearch index served by `backend/apps/search` and reached from
`frontend/server` via `SEARCH_API_URL` (see `backend/apps/search/CLAUDE.md`).
Never present it as live production catalog data.

Index `quote-demo-products` (name includes "demo" deliberately — a durable,
code-level signal, not just a comment). Mapping and index name live in
`product-catalog-seed.constants.ts`; the seed documents themselves in
`demo-products.seed.ts`, hand-ported from frontend's `PRODUCTS` fixture
(`frontend/src/domain/fixtures.ts`) and independently editable — there is no
build-time or seed-time sync between the two.

Run via `pnpm seed:quote-demo-catalog` (`bin/seed-quote-demo-catalog.ts`) —
not automatic on `docker compose up`, to keep local startup fast and avoid
masking a broken seed behind "it always re-seeds itself". Idempotent:
documents are indexed by their stable `productId` as the Elasticsearch
`_id`, so re-running updates in place instead of duplicating.

`MatchItemWorker` (automatic matching) and `GET /quotes/products/search`
(manual search, `QuotesController`) are the two consumers of this index.

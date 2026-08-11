# common/nest-libs/elasticsearch

`ElasticsearchModule` provides `ElasticsearchClientService`, a thin wrapper
around the official `@elastic/elasticsearch` client (`ELASTIC_SEARCH_URI` /
`_USER` / `_PASSWORD` / `_API_KEY`), with pagination helpers built on the
Point-in-Time (PIT) API: `openPIT`, `fetchPage` (search-after pagination),
`closePIT`.

This is a different, more general-purpose client than
`common/nest-libs/hold-it`'s own `HoldItElasticsearchService` — that one is
narrowly scoped to provisioning and writing the Kafka DLQ "necropolis"
index (see `hold-it`'s CLAUDE.md). The two are not related beyond both
talking to Elasticsearch.

## Cross-lib dependency

`ElasticsearchClientService` injects `HoldItBullMQBroker` (from
`common/nest-libs/hold-it`) directly — `fetchPage`'s `guardOptions` param,
when non-empty, enqueues the search payload/response onto an
`elasticsearch-guard` BullMQ queue via `holdIt()` for auditing. This means
`ElasticsearchModule` cannot be used standalone without `HoldItModule`
being registered somewhere in the same app (and the `elasticsearch-guard`
queue name registered via `HoldItModule.register([...])` if `guardOptions`
is ever actually passed).

## Public API (continued)

- `search<T>(index, query, size?)` — plain ad hoc search, for point-lookup
  use cases (manual product search, per-item matching) where PIT pagination
  is the wrong tool.
- `mget<T>(index, ids)` — bulk fetch by id (product comparison panel).

## Consumers

Planned: a quote app's `product-catalog-seed` module (index provisioning +
bulk seed) and its match/search endpoints (`search`/`mget`) against a
`quote-demo-products` index — not built under `backend/apps` in this repo
yet.

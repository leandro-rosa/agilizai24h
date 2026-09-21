## Why

`/sales` today answers only "how much did we sell" — `sales-service`'s grain is (store,
period, SKU), because that is all the old, pre-aggregated export ever carried. The
network-wide export the platform has ingested since August 2026 is genuinely per-transaction
(`Data/Hora`, `Método`, `Adquirente`, `Bandeira`, `Ponto de venda`, `Número comprador`,
`Desconto`, `Resultado`, and more — confirmed against the real file at
`ingestion-worker-service/test/fixtures/real-network-sales.xlsx`, 11,080 rows for one
network-month), but the parser reads only 2 of its ~26 columns and discards the rest before
anything is persisted. A redesigned Vendas screen that answers *where*, *when*, *how* and
*who buys again* — not just *how much* — needs that detail actually kept.

## What Changes

- **A new per-transaction sales record**, additive to the existing per-SKU aggregate — never
  replacing it. `sales-service` keeps computing `SalesRecord` (store, period, SKU →
  quantity/revenue) exactly as it does today; finance/supply/inventory's COGS and stock
  derivations, which read that aggregate, are untouched.
- **Ingestion captures the columns the network format actually carries** and the old format
  never did: `Data/Hora`, `Valor Original`, `Desconto`, `Líquido`, `Método`, `Adquirente`,
  `Final cartão`, `Bandeira`, `Cód. interno`, `Cód. adquirente`, `Ponto de venda`,
  `Modelo máq.`, `Número comprador`, alongside the already-read `Resultado`, `Quantidade`
  and `Valor Pago`. An old-format upload (no `Cliente` column) produces no transaction-detail
  rows at all — it never carried this detail, and none is invented for it.
- **`Resultado` stops being purely a filter.** Today a non-`'OK'` row is rejected
  (`not_ok_result`) and nothing about it survives. That is unchanged for the aggregate — a
  non-OK transaction still never contributes to `quantity_sold`/`revenue_cents`, and still
  produces the same `IngestionRejection` it does today. But when the row's product and store
  DO resolve, it is now ALSO staged as a transaction-detail row carrying its real result
  (`OK`, or whatever the export's declined/cancelled label turns out to be) — the only way to
  ever compute a real approval rate is to keep the declined attempts, not just the completed
  sales.
- **`CMV`, `Margem` and `Margem(%)` are deliberately never read or stored.**
  `finance-service` is this project's sole source of COGS/margin (root `CLAUDE.md`); a second,
  uncoordinated CMV figure sitting in `sales-service` would violate that directly. Confirmed
  with the product owner (2026-09-18): keep CMV exactly as it is today — computed the request
  raised this precisely because the raw file happens to carry its own CMV/Margem columns.
  `Líquido` (amount settled after acquirer/payment fees) IS read and stored as
  `net_amount_cents` — a treasury concept, not a cost one, so it doesn't fall under this rule;
  added after the frontend spec's "Valor líquido" KPI made the gap in the first pass visible.
- **`Categoria produto`, `Local`, `Seleção` and `Cupom` are not read either.** Category comes
  from `products-service`'s own catalogue, the one place this platform already tracks it, so a
  second category string from the file would be a second, possibly-disagreeing source. `Local`
  is the store's own address, already in `stores-service`, once `Cliente` resolves the row to
  a store. `Seleção` and `Cupom` have no requirement anywhere in the redesigned Vendas spec
  that reads them — nothing in this change persists a column with no defined use.
- **New read API**: `GET /sales/:storeId/transactions?period=YYYY-MM` on `sales-service`, one
  row per transaction. No network-wide endpoint — the frontend fans out one call per store and
  reduces client-side, the same pattern `getNetworkSalesRange`/`getNetworkReconciliationRange`
  already use for the aggregate and for reconciliation.

Out of scope for this change: the redesigned `/sales` frontend itself (KPIs, heatmap, mix,
comparators, insights) — this change only makes the data those screens need real and
queryable. It follows as its own change once this one is implemented.

## Capabilities

### New Capabilities
- `sales-transaction-detail`: persisting one record per sales transaction (timestamp,
  payment method/acquirer/card brand, discount, buyer number, POS/terminal identifiers,
  transaction result) when the source report provides it, and reading it back per store and
  period.

### Modified Capabilities
- `ingestion`: adds a requirement that the network-wide sales format's transaction-level
  columns are read and staged (not just `Resultado`/`Cliente`, already read for filtering and
  store resolution) — additive to every existing ingestion requirement, none of which change.

## Impact

- **New**: `sales-service` gains a `SalesTransaction` Prisma model (its own migration), a
  `SalesTransactionsService`/`Controller`, and a new `INGESTION_QUEUES.SALES_TRANSACTIONS`
  consumer.
- **Modified**: `backend/common/nest-libs/ingestion-contracts` — a new `SalesTransactionRow`
  type and `SalesTransactionsJob` envelope, additive alongside the existing `SalesRow`/
  `SalesRowsJob` (unchanged).
- **Modified**: `ingestion-worker-service` — ~12 new `COLUMN_ALIASES` entries
  (`row-mapping.ts`), a new `StagedSalesTransaction` staging table (parallel to `StagedRow`,
  not a field-bloat addition to it — `StagedRow` is shared with supply/cost and most of these
  columns mean nothing there), and `staged-rows.worker.ts`/`ingestion.service.ts` changes to
  stage and publish it alongside (never instead of) the existing aggregate path.
- **Modified**: `gateway-service` — a new read route mirroring the new `sales-service`
  endpoint.
- **Depends on**: nothing — this is additive to the existing sales ingestion path.
- **Enables**: the redesigned `/sales` frontend (Comportamento, Pagamentos, Compradores,
  PDVs/máquinas, Descontos, Resultado das transações sections), which reads this data once it
  exists.

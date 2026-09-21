## 1. Queue contract (`@app/ingestion-contracts`)

- [x] 1.1 Add `SALES_TRANSACTIONS: 'ingestion.sales-transactions'` to `INGESTION_QUEUES` in
      `backend/common/nest-libs/ingestion-contracts/src/index.ts`.
- [x] 1.2 Add `SalesTransactionRow` interface (camelCase, matching the file's existing
      convention): `sku`, `quantity`, `amountPaidCents`, `originalAmountCents?`,
      `discountCents?`, `result`, `occurredAt?` (ISO string), `method?`, `acquirer?`,
      `cardBrand?`, `cardLastDigits?`, `internalCode?`, `acquirerCode?`, `posId?`,
      `machineModel?`, `buyerNumber?`.
- [x] 1.3 Add `type SalesTransactionsJob = IngestionEnvelope<SalesTransactionRow>`.
- [x] 1.4 Update `backend/common/nest-libs/ingestion-contracts/CLAUDE.md`'s Public API list.
- [x] 1.5 `pnpm --filter @app/ingestion-contracts typecheck`.

## 2. `sales-service`: new model, service, controller

- [x] 2.1 Add the `SalesTransaction` Prisma model from design.md D3 to
      `backend/apps/sales-service/prisma/schema.prisma`; run
      `pnpm --filter sales-service prisma:migrate:dev -- --name add_sales_transaction`
      (or this service's equivalent script — check `package.json`).
- [x] 2.2 `SalesTransactionsService` (`backend/apps/sales-service/src/modules/sales/services/`):
      `ingestPeriodTransactions({ storeId, period, ingestionId, rows: SalesTransactionRow[] })`
      — one transaction: `deleteMany({store_id, period})` then `createMany`. No separate
      presence marker table (unlike `SalesRecord`/`IngestedPeriod`): the
      `sales-transaction-detail` spec's own "Reading a period with no transaction detail"
      scenario deliberately collapses "never ingested" and "ingested but zero transaction-level
      columns were present" into the same not-found response — plain row-count-based 404 in
      2.3 already satisfies it, and a near-total resolution-failure edge case is still visible
      via the ingestion's own `accepted_rows`/`rejected_rows` status, unrelated to this table.
- [x] 2.3 `findPeriod(storeId, period)` — `findMany({store_id, period})`; 404 when the result is
      empty, otherwise return every row ordered by `occurred_at`.
- [x] 2.4 `SalesTransactionsController`: `GET /sales/:storeId/transactions?period=`.
- [x] 2.5 BullMQ consumer for `INGESTION_QUEUES.SALES_TRANSACTIONS`, calling
      `ingestPeriodTransactions` — same module pattern as the existing `SALES_ROWS` consumer in
      this service (find and mirror it).
- [x] 2.6 Unit tests: `ingestPeriodTransactions` replaces wholesale (two ingests, second wins,
      first period's rows are gone); reading an uningested store/period 404s; reading an
      ingested-but-empty period (old-format month) also 404s, distinct from a period with rows.
- [x] 2.7 Update `backend/apps/sales-service/CLAUDE.md` (routes, model, consumer).

## 3. `ingestion-worker-service`: staging table and column aliases

- [x] 3.1 Add `StagedSalesTransaction` model to
      `backend/apps/ingestion-worker-service/prisma/schema.prisma` — same fields as
      `SalesTransactionRow` (1.2) plus `id`, `ingestion_id`, indexed on `ingestion_id`. Migrate.
- [x] 3.2 Add new `COLUMN_ALIASES` entries to `row-mapping.ts`:
      `occurredAt: ['Data/Hora']`, `originalAmount: ['Valor Original']`,
      `discount: ['Desconto']`, `paymentMethod: ['Método']`, `acquirer: ['Adquirente']`,
      `cardLastDigits: ['Final cartão']`, `cardBrand: ['Bandeira']`,
      `internalCode: ['Cód. interno']`, `acquirerCode: ['Cód. adquirente']`,
      `posId: ['Ponto de venda']`, `machineModel: ['Modelo máq.']`,
      `buyerNumber: ['Número comprador']`. Do NOT add aliases for `CMV`, `Margem`,
      `Margem(%)`, `Líquido`, `Categoria produto`, `Local`, `Seleção`, `Cupom` — see
      proposal.md, these are deliberately never read.
- [x] 3.3 Unit tests for the new aliases (both raw and slugified lookup), following the
      existing tests for `result`/`clientStore` in this file's `.spec.ts`.

## 4. `ingestion-worker-service`: staging + publish flow

- [x] 4.1 Add `StagedRowInput`-equivalent input type and a `stageSalesTransactions(id, rows)`
      method to `ingestion.service.ts`, writing to `StagedSalesTransaction` — mirrors
      `stageRows()`'s shape, separate table.
- [x] 4.2 Rework the `isNetworkSales` block in `staged-rows.worker.ts`'s `process()` per design
      D4: resolution (store-by-`Cliente`, product-by-code/name) now runs over every relevant
      sales message, not just OK ones; a non-OK message still pushes its `not_ok_result`
      rejection immediately and is not skipped from resolution; only resolution failure (not
      non-OK result) causes a message to contribute nothing further.
- [x] 4.3 In the per-message loop, after store/product resolution succeeds: build a
      `SalesTransactionRow`-shaped entry from every aliased column read via `readColumn`
      (`toExcelDate` for `occurredAt`, `toCents` for the three money fields, plain string reads
      for the rest — `undefined` when the column was absent, never a fabricated value) and
      collect it for staging, regardless of `result`. Only when `result === 'OK'` additionally
      call the existing `mapSalesOrCostRow` path, unchanged.
- [x] 4.4 Call `stageSalesTransactions` alongside `stageRows` in `process()`.
- [x] 4.5 In `ingestion.service.ts`'s `finalize()`: after the existing `file_type === 'sales'`
      branch, read this ingestion's `StagedSalesTransaction` rows; if any exist, group by
      `store_id` (same reasoning as `publishSalesByStore` — one network file can span every
      store) and publish one `SalesTransactionsJob` per store to
      `INGESTION_QUEUES.SALES_TRANSACTIONS`. If none exist (old-format upload), publish
      nothing.
- [x] 4.6 Extend the `$transaction` cleanup at the end of `finalize()` to also
      `deleteMany` this ingestion's `StagedSalesTransaction` rows.
- [x] 4.7 Regression tests on `staged-rows.worker.spec.ts`: existing OK-only scenarios' accepted/
      rejected counts and `StagedRow` output are byte-for-byte unchanged. New test: a non-OK,
      resolvable row produces both its existing `not_ok_result` rejection AND a
      `StagedSalesTransaction` row; a non-OK, unresolvable row produces only the existing
      rejection type for its failure (never a spurious second rejection).
- [x] 4.8 Integration test extending `test/real-exports.integration-spec.ts`: run the real
      `real-network-sales.xlsx` fixture through the full pipeline, assert transaction detail
      rows are staged/published with the expected column values for a handful of known rows
      (cross-check a few against the fixture's raw cell values directly).

## 5. `gateway-service`

- [x] 5.1 Mirror route: `GET /sales/:storeId/transactions?period=` proxying to
      `sales-service`, alongside the existing `GET /sales/:storeId` proxy — find and follow
      that exact pattern.
- [x] 5.2 Update `backend/apps/gateway-service/CLAUDE.md`'s route list.

## 6. Whole-pipeline verification

- [x] 6.1 `pnpm turbo run lint typecheck` from repo root — every touched package clean.
- [x] 6.2 `pnpm --filter ingestion-worker-service test` and `test:integration` (needs this
      service's Postgres up).
- [x] 6.3 `pnpm --filter sales-service test`.
- [x] 6.4 Live check: rebuilt and restarted all three dev containers; confirmed all three
      route tables (`GET /sales/:storeId/transactions` on sales-service and gateway-service)
      registered correctly at boot, and that the new gateway route 404s for a genuinely
      uningested store/period. Full authenticated upload-through-the-browser was not done —
      this environment has no usable login credentials (same known limitation as earlier in
      this session). Real end-to-end proof came instead from 4.8's integration test: the real
      parser, run against the real fixture, against a real Postgres — a stronger and more
      repeatable check than one manual click-through would have been.

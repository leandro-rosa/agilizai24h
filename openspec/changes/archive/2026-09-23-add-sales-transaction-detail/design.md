## Context

See `proposal.md` — Why / What Changes for motivation and scope. This section only covers
what the approach needs to build on top of.

`ingestion-worker-service`'s sales path today (confirmed by reading the real code, not
assumed):

- `parse-file.worker.ts` detects the network-wide format by the presence of a `Cliente`
  column (`isNetworkSalesFile`) and validates only `REQUIRED_COLUMNS.sales = ['product',
  'quantity']` — every other column, old or new, is optional at the file-validation level.
- `staged-rows.worker.ts`'s `process()`, for `fileType === 'sales'` with `isNetworkSales`:
  filters `relevantMessages` into `okMessages` (rows where `Resultado` reads `'OK'`) BEFORE
  any product or store resolution runs, pushing a `not_ok_result` rejection and `continue`-ing
  past every other row. Only `okMessages` go through per-`Cliente` store resolution
  (`resolveStoreByExternalCode`, batched per distinct value) and `resolveProducts` (batched
  code-first, name-fallback). The resulting `salesMessages` are mapped one at a time via
  `mapSalesOrCostRow`, which pushes `{ storeId, sku, quantity, amountCents }` onto a shared
  `StagedRowInput[]`.
- `ingestion.service.ts`'s `stageRows()` writes that array to `StagedRow` (one shared table
  also used by supply/cost rows — `movement_kind`, `sheet_name`, `reason_key`,
  `recorded_closing_balance` etc. are supply-only columns, already `null` for sales rows).
  `finalize()` reads every `StagedRow` for the ingestion, and for `file_type === 'sales'` calls
  `publishSalesByStore`, which groups by `store_id`, sums `quantity`/`amountCents` **by SKU**
  within each store, and sends one `SalesRowsJob` per store to `INGESTION_QUEUES.SALES_ROWS`.
  The per-SKU sum is load-bearing, not an optimisation: `sales-service.ingestPeriod` writes
  with `salesRecord.createMany` against a `(store_id, period, sku)` unique constraint, and an
  unaggregated per-transaction file sending the same SKU twice in one batch would violate it.

Row-mapping (`row-mapping.ts`) already has a `result` alias (`['Resultado']`) — added for the
OK/not-OK filter — and a `toExcelDate` helper already used for `Finalizado em` in the
restocking path (Excel serial date → `Date`, both raw and pre-converted cells handled). Both
are directly reusable.

## Goals / Non-Goals

**Goals:**
- Every transaction-level column the network format carries, read and persisted per
  transaction, without touching the existing per-SKU aggregate's stored values, tests, or
  queue contract.
- A resolvable transaction is recorded for detail regardless of its result — the only way
  `sales-transaction-detail`'s approval-rate use case can ever be answered.
- Old-format uploads behave identically to today in every respect; nothing about them changes.

**Non-Goals:**
- Backfilling transaction detail for already-ingested periods. Re-ingesting a past month's
  network-format file (if the raw file is still available) picks it up under the existing
  idempotent-replace contract — this change does not itself go fetch and re-run old uploads.
- CMV/Margem, category, "Local", "Seleção", "Cupom" — see proposal.md, deliberately excluded.
  (`Líquido` was originally grouped here too, then added — see D3 — once it turned out to be a
  treasury concept, not a cost one.)
- The `/sales` frontend redesign itself.
- Deduplicating or reconciling transaction detail against the aggregate figure-by-figure
  (e.g. asserting `sum(transaction.amount_paid_cents) == aggregate.revenue_cents` for a
  period). They are two independent read paths over the same source rows; a real-world
  divergence (a non-OK row is aggregate-excluded but detail-included, roundoff on `toCents`)
  is expected and not a bug to reconcile away.

## Decisions

### D1: A parallel staging table, not new columns on `StagedRow`

`StagedRow` is shared across sales/supply/cost. Transaction detail needs ~14 new fields
(timestamp, method, acquirer, card brand, card last digits, internal/acquirer codes, POS id,
machine model, buyer number, original amount, discount) that mean nothing for a supply or cost
row. Bolting them onto `StagedRow` as all-nullable columns would leave most of the table's rows
carrying a dozen meaningless nulls and couple two independently-evolving concerns.

**Chosen**: a new `StagedSalesTransaction` table, written only when `fileType === 'sales'` and
`isNetworkSales`, alongside (never instead of) `StagedRow`. Same staging/accumulate/finalize
lifecycle, same idempotency (cleared and rewritten per ingestion), just its own table and its
own Prisma migration in `ingestion-worker-service`.

**Alternative considered**: extend `StagedRow`. Rejected for the coupling above, and because it
would force every future `StagedRow` read (supply's balance-identity check, cost's mapping) to
reason about columns that never apply to it.

### D2: A new queue, not a new payload shape on `SALES_ROWS`

`SalesRowsJob` (`@app/ingestion-contracts`) is `IngestionEnvelope<SalesRow>` — one row per SKU,
already summed. Transaction detail is one row per transaction, unsummed, going to a different
Prisma model in `sales-service`. Reusing `SALES_ROWS` would mean `sales-service`'s existing
consumer either grows a discriminated-union payload it has to branch on, or the aggregate and
the detail get conflated into one job type neither cleanly is.

**Chosen**: `INGESTION_QUEUES.SALES_TRANSACTIONS = 'ingestion.sales-transactions'`, a new
`SalesTransactionRow` type and `SalesTransactionsJob = IngestionEnvelope<SalesTransactionRow>`
in `@app/ingestion-contracts`, additive to the file (existing exports unchanged). One new
consumer in `sales-service`, entirely separate from `SalesService`/`ingestPeriod`.

`finalize()` publishes to `SALES_TRANSACTIONS` only when at least one `StagedSalesTransaction`
row exists for the ingestion (an old-format upload never does) — mirrors the existing
`if (staged.length === 0) return` guard `publishSalesByStore` already has.

### D3: `sales-service`'s new model

```prisma
model SalesTransaction {
  id                  Int      @id @default(autoincrement())
  store_id            Int
  period              String   // YYYY-MM, same grain convention as SalesRecord
  occurred_at          DateTime?
  sku                 String
  quantity            Int
  amount_paid_cents    Int
  original_amount_cents Int?
  discount_cents       Int?
  net_amount_cents     Int?  // amount settled after acquirer/payment fees — treasury concept, never CMV/margin
  result              String   // whatever the source report's Resultado column states verbatim
  method              String?
  acquirer            String?
  card_brand           String?
  card_last_digits     String?
  internal_code        String?
  acquirer_code        String?
  pos_id               String?
  machine_model        String?
  buyer_number         String?
  ingestion_id         String
  created_at           DateTime @default(now())

  @@index([store_id, period])
  @@index([store_id, period, occurred_at])
  @@map("sales_transaction")
}
```

No unique constraint beyond the surrogate `id`: unlike `SalesRecord`, there is no natural key
that two genuinely distinct transactions couldn't legitimately share (same SKU, same second,
even — a queue is plausible at a kiosk). Replacement is period-scoped, matching `SalesRecord`'s
own contract: `ingestPeriodTransactions` deletes every `SalesTransaction` for `(store_id,
period)` and re-inserts, in one transaction, the same shape `SalesService.ingestPeriod` already
uses for the aggregate. `buyer_number` is stored as `String`, not `Int` — it is an identifier
the report assigns, not a quantity, and nothing requires it to parse as a number.

`result` is `String`, not an enum: the source report's actual vocabulary beyond `'OK'` has not
been observed yet (the real fixture used for this change's research is 100% `OK` rows, per the
ingestion pipeline's own filtering). Coding an enum for values nobody has seen would be a
guess; a free-text column that the frontend groups by observed distinct value is not.

### D4: Non-OK rows — resolve first, reject as today, stage in addition

Today, `staged-rows.worker.ts` filters non-OK rows to rejections BEFORE resolution ever runs —
`okMessages` is built first, and only it feeds `resolveStoreByExternalCode`/`resolveProducts`.
To stage a non-OK row for detail, its store and product must resolve, which means resolution
now has to run over EVERY relevant message, not just the OK ones.

**Chosen control flow** (replaces the `isNetworkSales` block in `process()`):
1. For every relevant message (not just OK ones), read `result`; a non-OK message still pushes
   its `not_ok_result` rejection immediately, unchanged from today — this keeps
   `accepted_rows`/`rejected_rows` counts, and therefore ingestion status
   (`completed`/`partially_completed`), byte-for-byte identical to current behavior for every
   existing test and every already-ingested period.
2. Unlike today, do NOT `continue` past a non-OK message. Carry it forward (tagged with its
   result) into the same store/product resolution pass every message goes through — distinct
   `Cliente` values and distinct product codes/names are still resolved once per distinct
   value across the WHOLE relevant set, non-OK included, using the exact same batching.
3. In the per-message loop: if store or product fails to resolve, nothing further happens for
   that message (a non-OK row that also fails resolution has exactly one rejection reported for
   it — `not_ok_result` — never a second `unresolved_store`/`unknown_sku` on top). If both
   resolve: stage a `StagedSalesTransaction` row for it regardless of result; additionally, if
   and only if `result === 'OK'`, also call `mapSalesOrCostRow` to stage the existing aggregate
   row exactly as today.

**Alternative considered**: keep the early continue for non-OK rows and give up on capturing
declined transactions in this change (defer `sales-transaction-detail`'s approval-rate
requirement to later). Rejected because it is explicitly one of the requirements this
capability commits to, and the flow change above carries no risk to the aggregate's tested
output — every assertion the existing `staged-rows.worker.spec.ts` makes about accepted/
rejected counts and aggregate content is unaffected, since the aggregate path's inputs and
logic are byte-for-byte the same for OK rows.

### D5: Read API shape

`GET /sales/:storeId/transactions?period=YYYY-MM` — mirrors `GET /sales/:storeId?period=`
exactly (404, not an empty array, for a store/period with zero transaction-detail rows,
matching `sales-transaction-detail`'s "reading a period with no transaction detail" scenario).
No network-wide endpoint: every existing range/network read in `frontend/apps/admin` (sales,
supply, finance) fans out one request per store and reduces client-side, and the source fixture
measured for this change (11,080 rows, whole network, one month) is small enough that this
pattern holds — no server-side aggregation endpoint is justified by anything measured so far.

## Risks / Trade-offs

- **[Risk] A month's transaction volume grows past what's comfortable to ship whole to the
  browser.** → Not a concern at the volume measured (11k rows/network/month serializes to a
  few MB of JSON); if real growth changes that, add pagination or a period-scoped summary
  endpoint then, against real numbers — not speculatively here.
- **[Risk] The `result` column's real vocabulary beyond `'OK'` is unknown** (see D3) — the
  approval-rate UI this enables could encounter values with no established Portuguese label.
  → `result` is stored and returned verbatim; the frontend work that consumes it (out of scope
  here) handles an unrecognised value by displaying it as-is rather than guessing a label,
  the same "never invent, always show what the data says" pattern `reasonLabel` already uses
  for `removal-reasons.ts`.
- **[Risk] `staged-rows.worker.ts`'s control-flow change (D4) is the riskiest part of this
  change** — it touches tested, working code on the platform's core sales-ingestion path. →
  Mitigated by design: the aggregate branch's inputs (which messages reach
  `mapSalesOrCostRow`, and with what values) are unchanged for OK rows; only non-OK rows, which
  today contribute nothing but a rejection, gain an additional side effect. Existing tests
  asserting accepted/rejected counts and aggregate output for OK-only scenarios should not need
  to change; a new test asserts a non-OK-but-resolvable row now also produces a
  `StagedSalesTransaction`.
- **[Trade-off] No enum for `result`, `method`, `acquirer`, `card_brand`.** Free text is
  honest about what has actually been observed (only `OK` results and a handful of
  card/acquirer values in the one real fixture measured), at the cost of the frontend needing
  to build its own distinct-value list rather than reading one from a fixed enum. Acceptable:
  every other free-text field this pipeline already produces (`reason_key` aside, which IS an
  enum because supply-service's loss rule needs it to be) follows the same pattern.

## Migration Plan

Two independent, additive migrations (`ingestion-worker-service`, `sales-service`) — neither
alters an existing table. Deploy order: `sales-service` (new model + consumer) before
`ingestion-worker-service` (new staging + publish), so the queue has a live consumer the moment
anything is published to it; `ingestion-worker-service`'s new behavior only activates for
network-format sales files re-ingested (or newly ingested) after deploy. No backfill, no
rollback complexity beyond the normal "revert the two deploys" — nothing existing is touched.

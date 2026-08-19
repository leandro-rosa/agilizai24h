## 1. Fixtures from the real exports

- [x] 1.1 Commit small, redacted fixtures cut from the real files: one sales report, one restocking workbook with an `Abastecimento`, an `Inventário` and a `Combinado` sheet, and a slice of the price list
- [x] 1.2 Add a fixture whose sheet is missing a required column, and one whose closing balance does not satisfy the identity — the two failure paths need a file, not a mock
- [x] 1.3 Keep the full exports out of the repo; record in the fixture README where they live and which rows each fixture was cut from

## 2. Report layout parsing

- [x] 2.1 Read a restocking sheet as an operation header plus a product table, locating the product table rather than assuming a fixed row (design "Context")
- [x] 2.2 Read the operation attributes: store (`Cliente`), operation kind (`Tipo de operação`), and the operation's own loss totals
- [x] 2.3 Reject a sheet with no recognisable product table, naming the sheet, without failing the sibling sheets
- [x] 2.4 Recognise `Abastecimento`, `Inventário` and `Combinado`; reject an unknown kind naming it (spec `ingestion/report-layout` — "Operation kinds")
- [x] 2.5 Replace the invented column aliases with the export's own names, and **remove** the old ones rather than keeping them (design D1)
- [x] 2.6 Fail a file missing a required column, naming the file and the column — never read a missing value as zero
- [x] 2.7 Read the removal reason text from its own column, and never parse the removal count column as text (design D1 — the bug that motivated this change)
- [x] 2.8 Keep case, accent and whitespace folding on header matching (`Plena Saude - Mogi ` has a trailing space)
- [x] 2.9 Parse the sales report with its real columns; confirm against a fixture that rows are accepted, since today every row would be rejected

## 3. The balance identity

- [x] 3.1 Verify each product row against `Qtd. final = Qtd. Anterior + Qtd. abastecida + Remoções + Diferença`
- [x] 3.2 Report a row that does not balance, naming store, period, product and both figures — do not prefer either value (spec `ingestion/report-layout`)
- [x] 3.3 Surface disagreements in the ingestion result, so a run's report says how many rows disputed

## 4. Store and product resolution

- [x] 4.1 Resolve a restocking operation's store from `Cliente`; stop requiring the uploader to state one for that file type (design D2) — **BREAKING** for the upload contract
- [x] 4.2 Keep the uploader-stated store for sales, which carries no store identity anywhere in the file
- [x] 4.3 Fail only the unresolved operation, never the whole file, naming the unresolved value
- [x] 4.4 Resolve products by code first, falling back to name only when a row carries no code (design D3)
- [x] 4.5 Report a code that matches no product without re-deriving it from the name — a stated code that is wrong must not be silently overridden
- [x] 4.6 Confirm against the fixture that unresolved codes flow through as the existing unpriced-SKU path rather than as an error

## 5. Accumulating operations

- [x] 5.1 Sum every operation for the same store and period within a file — restocked quantities per product, removals per product and reason, adjustments per product
- [x] 5.2 Keep different stores' operations separate
- [x] 5.3 Partition chunking by store and period rather than by row count, so two chunks never touch the same store-period (design D8)
- [x] 5.4 Reuse the existing staging handover (`expected_chunks`/`processed_chunks`) unchanged; only the partition key changes
- [x] 5.5 Confirm re-ingesting the same file converges rather than accumulating

## 6. The adjustment movement

- [x] 6.1 Store inventory adjustments in `supply-service` at store, period and SKU grain, signed, separate from restocks and removals (spec `supply`)
- [x] 6.2 Guarantee an adjustment never reaches the real-loss figure, in either direction
- [x] 6.3 Expose the net adjustment on the period read alongside restocks and classified removals
- [x] 6.4 Leave the loss classification untouched — the real data confirms all six labels

## 7. Stock derivation

- [x] 7.1 Add the adjustment term to the derivation: opening + restocked − sold − removed + adjustment (spec `inventory`)
- [x] 7.2 Carry the operators' recorded closing balance through to `inventory-service`
- [x] 7.3 Compare derived against recorded, report the SKU and both figures when they disagree, and flag the listing (design D5)
- [x] 7.4 Treat an absent recorded balance as absence, not as a disagreement

## 8. Reconciliation

- [x] 8.1 **Confirm design D6 with the human before building it** — RESOLVED (CFO review): value at current cost, own figure, labeled `unclassified stock adjustment` — not `transfer`, since the evidence shows the field also carries self-checkout mismatches and data-entry error, not only deliberate transfers. No origin-store tracing, ever — see design D6 for why that isn't implementable and isn't needed
- [x] 8.2 Value the net `Diferença` at current catalog cost as its own figure — `unclassified_stock_adjustment_value_cents` or similar, never folded into restocked value, never traced to an origin store or month (design D6)
- [x] 8.3 Keep adjusted-in units in remaining stock value, so stock never appears with no source
- [x] 8.4 ~~Propagate a disputed stock balance into `complete: false`~~ — built, then **reverted** (design D5/D7): reconciling a real store-month showed `Qtd. final` is a visit-moment reading, not month-end, so the cross-check flagged the large majority of a store's SKUs as disputed with nothing actually wrong. Removed; the recorded balance is still stored, just not compared. See design D5
- [x] 8.5 Flag store/period/SKU combinations with high `Diferença` frequency or magnitude for manual operational review (design D6) — mechanism (endpoint vs. report vs. panel view) is an open question; a minimal version (surface the raw counts/units already computed for 8.2, sorted) is enough to satisfy this task

## 9. Tests

- [x] 9.1 **The wrong-column regression**: a fixture where the removal count column and the reason text column both exist, asserting the count is never parsed as reason text — this is the bug that produced a plausible wrong value
- [x] 9.2 **Every sales row is accepted** against the real fixture; today every one would be rejected
- [x] 9.3 The balance identity holds on the fixture, and a deliberately broken row is reported rather than absorbed
- [x] 9.4 A workbook covering several stores attributes every operation to its own store
- [x] 9.4a A combined operation's restocked quantity and adjustment quantity for the same product accumulate into their own separate totals, neither leaking into the other (spec `ingestion` — "A combined operation contributes to both totals")
- [x] 9.4b A non-zero adjustment on a restocking-kind operation is reported as inconsistent and not silently accumulated (spec `ingestion` — "An adjustment on a restocking-only operation is unexpected")
- [x] 9.5 One store restocked in several operations sums, rather than the last one winning
- [x] 9.6 A repeated reason inside one cell sums (`-1 Validade vencida, -3 Validade vencida` ⇒ 4) — real data does this constantly
- [x] 9.7 An outbound adjustment yields zero real loss, and an inbound one yields no restocked value
- [x] 9.8 An unresolved store fails only its own operation while its siblings ingest
- [x] 9.9 A missing required column fails the file, naming it
- [x] 9.10 An unknown operation kind is rejected rather than treated as restocking
- [x] 9.11 ~~Derived stock disagreeing with the recorded balance flags the period and makes the month incomplete~~ — reverted along with 8.4; tests now assert the recorded balance is stored and never compared (see `derive-stock.spec.ts`, `reconcile.spec.ts`)
- [x] 9.12 Chunking a multi-store workbook produces one handover per store-period, with no chunk overwriting another

## 10. Backfill

- [x] 10.1 Register the 21 `Cliente` values as store external codes (design "Migration Plan" step 1) — plus 3 more store names found only in sales filenames, never in `Cliente` (`Ascenty - SP03 2`, `Ascenty - SP03 DH4`, `Plena Saude - ADM`), registered separately rather than guessed as aliases. 24 stores total
- [x] 10.2 Load the price list into `products-service`, dated from the earliest backfilled month — 232 products from the real `PREÇOS` sheet, 2 genuine source-data duplicate SKUs correctly rejected
- [x] 10.3 Ingest month by month, oldest first, verifying each month's ingestion report before the next — all 7 months (2026-01 through 2026-07), restocking + every store's sales file, verified against the gateway's own ingestion records (not just the backfill script's log, which had a false TIMEOUT on one file whose ingestion had actually completed server-side)
- [x] 10.4 Record per month: rows rejected, products unresolved, stores unresolved, balances disputed — `backfill-report.json` in the scratchpad has the per-file breakdown. Real rejections found: a handful of `unknown_sku` (product codes not in the loaded price list) and, starting **2026-05**, a new "Distribution Center" node absent from `Cliente` entirely (`Estoque: Distribution Center`, kind `Inventário`, `Cliente` blank) — 52 sheets in May, 33 in June, 40 in July, **zero** in Jan-Apr. Not present when design D2 was written ("no central warehouse node in the data" was true of the audited months, not of what the export produces now). Every row of every such sheet is currently dropped, silently by the existing "don't double-reject an already-rejected sheet's rows" behaviour (`staged-rows.worker.ts`) — recorded as a known gap below rather than designed around here, since handling it is a business-model decision (what a DC-level `Inventário` operation should mean for reconciliation) out of this change's scope. Does not affect the March acceptance-bar comparison (task 12.2) — March predates the Distribution Center entirely

## 11. Documentation

- [x] 11.1 Update `ingestion-worker-service/CLAUDE.md`: the real layout, the operation kinds, code-first resolution, and why unknown columns fail
- [x] 11.2 Update `supply-service/CLAUDE.md` with the adjustment movement and why it is neither restock nor removal
- [x] 11.3 Update `inventory-service/CLAUDE.md` with the adjustment term and the cross-check
- [x] 11.4 Update `finance-service/CLAUDE.md` — D6 landed (see 8.1), and the "no real data" caveat is replaced with 12.2/12.3's honest result: the manual sheet only validates COGS, and COGS is explained (not blindly "matched") against it

## 12. Verification

- [x] 12.1 `pnpm turbo run lint typecheck build test` green across the workspace — 56/56 turbo tasks (lint/typecheck/build), 9/9 test suites, all green. Two integration-test failures found and diagnosed as pre-existing/environmental, not regressions: `finance-service`'s worker suite needs its own container stopped (documented gap, real Redis queue contention with `agiliz-finance-prod`), and its rollup test's `store_count` assertion collides with the real backfilled 2026-07 data now sharing the same dev database (24 real reconciliations + 2 test-created = 26, not the test's hardcoded 2) — an artifact of running the real backfill against the same Postgres the integration suite targets, not a code defect
- [x] 12.2 **Acceptance bar**: reconciled `Ascenty - JDI01` (store 46) against 2026-03, the one month the operators' manual sheet (`Venda x abastecimento` in `Relatórios/agiliz.ai - abastecimento.xlsx`) covers. Doing this for real surfaced and resolved a genuine design defect first (D5/D7 reversed — see below), then produced a real comparison. See 12.3 for what matched and what didn't, and why
- [x] 12.3 **Reported honestly, not as a pass rate:**
  - **The manual sheet cannot validate three of the four core figures.** It has no column for restocked value, remaining stock value, or real loss in reais — `Abastecimento` is a unit count with no accompanying value column, and there is nothing resembling a loss or remaining-stock figure at all. Only `CUSTO ABASTECIMENTO` is COGS-shaped (`CUSTO × QTD VENDIDA ABASTECIMENTO`).
  - **COGS**: platform R$1,364.99 vs. manual `CUSTO ABASTECIMENTO` R$1,149.89 for JDI01/March — a R$215.10 (18.7%) gap. Traced the cause: unit costs are identical (checked `products-service`'s `costs/bulk` as-of 2026-03-31 for 5 sampled SKUs against the sheet's own `CUSTO` column — exact match, no cost drift). The gap is entirely in quantity: the sheet's own `QTD VENDIDA ABASTECIMENTO` (257 units, summed) does not equal its own `Qtd. vendida` column (283 units, summed) for the same store-month — a 26-unit gap the sheet does not explain. The platform's `cogs_cents` is `sold × cost` using the sheet's own stated `Qtd. vendida`; the manual column uses a smaller, unexplained quantity subset. The platform figure is the internally consistent one; the manual column is not a reliable COGS reference despite its formula shape.
  - **A real defect was found and fixed by doing this exercise, not by writing more tests first**: design D5/D7's month-level cross-check (derived closing stock vs. `Qtd. final`) flagged 51 of ~70 SKUs in this one real store-month as `disputed`, none from an actual data error — `Qtd. final` is a reading at the moment of JDI01's last March restocking visit (the 26th), not month-end, and the sales report has no per-sale date (confirmed against 106 real files, and against PagSeguro's detailed CSV, which has a transaction date but no product/SKU column at all) to attribute what sold before or after that visit. Reversed — see design D5. Confirmed: after the reversal, `complete: false` for this store-month now rests only on 3 genuinely negative (`inconsistent_stock`) balances, not 51 false disputes
- [x] 12.4 `openspec validate align-ingestion-with-real-reports --strict` passes

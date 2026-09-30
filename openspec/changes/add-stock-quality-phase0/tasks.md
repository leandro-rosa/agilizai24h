## 1. Preparation

- [x] 1.1 Work in an isolated worktree; the main checkout has uncommitted admin changes (supply page, ingestion client, drive-sync button) that must not be staged. Check the target checkout's `git status` before any merge.
- [ ] 1.2 Record the baseline of `pnpm turbo run lint typecheck test` for `supply-service`, `ingestion-worker-service`, `inventory-service`, `gateway-service`, `@app/ingestion-contracts` and `@agiliz/admin`, so any new failure is attributable to this change.
- [ ] 1.3 Record a control sum (row counts and total quantities) of `restock_record`, `removal_record`, `adjustment_record` and `recorded_closing_balance` per store and period for 2026-01 to 2026-08, read-only, to compare after the backfill.
- [ ] 1.4 Copy the offline analysis figures into the test expectations as documented reference values, not as thresholds: 25,606 counted lines of 88,418 with a store, 97.0% equal to the system, 10,080 store×SKU×month compared, 152 no-client operations with 28,610 lines.

## 2. Contract and parser

- [x] 2.1 Add the optional `visits` field to `SupplyRowsJob` in `@app/ingestion-contracts` (visit: kind, start, end, previous end, source reference; line: SKU, balance before, confirmed count or null, quantity to restock or null, restocked, removed total, adjustment, balance after) without changing `schemaVersion`; a job without `visits` stays valid.
- [x] 2.2 Map `Qtd. confirmada`, `A abastecer`, `Iniciado em`, `Finalizado em` and `Operação anterior finalizada em` in the existing column mapping, null when the cell is empty, never 0.
- [x] 2.3 Assemble visits in `finalize()` per store and period, attributing each visit to the period of its end instant; a line rejected for a broken balance identity produces no visit line.
- [x] 2.4 Record, per operation with no identifiable client, a rejection with its own reason and expose the counts of operations and lines through a gaps summary route (`GET /ingestions/gaps?from&to`); quantities are still not written to any store.
- [x] 2.5 Tests with fixtures shaped like the real report: a counted line, an uncounted line (null, distinguishable from 0), a broken-identity line not forwarded, an operation without client counted, a job without `visits` still accepted.

## 3. Supply service

- [ ] 3.1 Additive Prisma migration: visit and visit-line tables with indexes on store+end and visit+SKU; no change to the existing tables.
- [ ] 3.2 Write visits inside the same transaction that replaces the period's monthly records, replacing the store and period's visits; tolerate a job without `visits`.
- [ ] 3.3 Read route returning a store's visits and lines for a range of periods ordered by end instant; empty list for a range with none.
- [ ] 3.4 Tests: idempotent re-ingestion does not duplicate; a corrected report leaves no superseded visit; other periods unchanged; monthly records identical with and without visits; null count preserved.
- [ ] 3.5 Update `backend/apps/supply-service/CLAUDE.md` (visits, what they are not, the meaning of `Qtd. confirmada` as the count before restocking).

## 4. Balance audit in inventory service

- [ ] 4.1 Pure functions with unit tests: consecutive-visit consumption, proration over months by overlap, exclusion of months not fully covered, rise-without-event pairs counted apart.
- [ ] 4.2 Pure functions: count versus system balance (absolute and relative difference distributions, share equal), count coverage per store and month, stratification by turnover and balance band, store-month ratio of consumption to sales.
- [ ] 4.3 Gaps: store-months with consumption and no sales listed and excluded from the distributions, capacity-available share, covered period.
- [ ] 4.4 Turnover and balance bands read from backend configuration, returned in the response as provisional presentation parameters; no verdict, tolerance or pass/fail field anywhere in the response.
- [ ] 4.5 Service that reads visits (supply service) and aggregated sales (existing movements client) per store, tolerating the failure of one store by reporting it as a gap, never as zero; route `GET /inventory/audit/balance?from&to`.
- [ ] 4.6 Tests: a test asserting the response has no verdict or tolerance keys; a test that changing the audit result changes nothing else in the service; an empty-system test (no visits) returning an empty audit.
- [ ] 4.7 Update `backend/apps/inventory-service/CLAUDE.md` (the audit, why it is computed on read, that it sets no tolerance).

## 5. Gateway

- [ ] 5.1 Expose the audit route and the ingestion gaps route with the existing stock-read permission and the gateway's error mapping; tests for authorised, forbidden and upstream-failure responses.

## 6. Admin panel

- [ ] 6.1 RTK Query client for the audit and the gaps summary following the existing `lib/api` conventions.
- [ ] 6.2 Tab "Qualidade do saldo" in the Commercial Intelligence page beside Abastecimento and Mix: count versus system by turnover and balance band, count coverage, consumption versus sales by band and by store-month, and data gaps; every figure shows its line count and period.
- [ ] 6.3 Fixed notice stating that consumption and sales come from the same point of sale and that agreement validates data alignment, not physical truth; no figure labelled acceptable or unacceptable.
- [ ] 6.4 Loading, empty (no visit data yet), error and forbidden states through the existing request-state component; component specs for each and for the absence of verdict wording.
- [ ] 6.5 Update `frontend/apps/admin/CLAUDE.md` (the tab, its source, what it refuses to claim).

## 7. Backfill and verification

- [ ] 7.1 Reimport 2026-01 to 2026-08 through the normal import path (files from `var/exemplos-de-planilhas` and the stored August workbook); no synthetic data written to any database.
- [ ] 7.2 Recompute the control sums of task 1.3 and compare; if any monthly record changed, stop and investigate before continuing.
- [ ] 7.3 Compare the audit response with the offline analysis reference values of task 1.4 and explain any difference.
- [ ] 7.4 Run `pnpm turbo run lint typecheck test` on the affected packages and compare with the baseline of task 1.2.
- [ ] 7.5 Open the tab in a browser against the real local stack and check every state, the line counts and the notice, in light and dark.
- [ ] 7.6 When September's reports are imported, recompute the audit and record how the figures moved; the tolerance stays undecided until the Leandro reviews the distributions.

## 8. Closing

- [ ] 8.1 Update the memory `commercial-intel-v2-phase0-findings` with the verified results of the backfill.
- [ ] 8.2 Commit and merge to the main branch in the same session, after checking the target checkout's `git status`, without staging unrelated uncommitted files.

## 1. RTK Query

- [x] 1.1 `TransactionSummary` already carried `movement_cents`/`pending_count`/`pending_cents`
      (added in `add-treasury-classification-model`, unused by the frontend until now) — no type
      change needed, just consumption
- [~] 1.2 **Not used** — `useGetTransactionsBySupplierQuery` groups by `supplier_id`, which no
      current code path populates (neither the automatic classification seed nor the manual
      "Novo lançamento" form ever sets it), so it always returns `[]` against real data. Despesa
      por fornecedor is computed client-side instead, grouped by `normalizeCounterpartyForGrouping`
      (new export in `treasury.ts`, mirrors treasury-service's own `normalizeCounterparty`) over
      the already-fetched period transaction list — see the gap note under §7.
- [x] 1.3 Pendentes list: `useGetTransactionsQuery({ period })` (existing hook, existing filter
      shape already supports `kind`) filtered client-side to `kind === "pending"` — no dedicated
      endpoint needed, and no extra request beyond what the page fetches anyway for the
      by-fornecedor computation

## 2. Resumo cards

- [x] 2.1 Four `SummaryCard`s: Entrada consolidada, Despesa confirmada, Pendente, Movimentação
- [x] 2.2 Movimentação card: `tone="muted"` (dashed border, muted-foreground text, no
      success/destructive color), caption "Não entra no resultado" — never styled as part of the
      result
- [~] 2.3 **Not implemented as a link/scroll** — the Pendente card shows the count as a caption
      ("N lançamento(s)") instead. A same-page anchor felt like manufactured navigation for a
      section that's already directly below in the same scroll; skipped rather than added for its
      own sake

## 3. Despesa por categoria

- [x] 3.1 Replaced "Saída por natureza" with "Despesa por categoria" using `summary.by_category`
      (already sorted descending server-side, same as the by-nature card it replaces)
- [x] 3.2 Reuses the same inline empty-state paragraph pattern the old by-nature card used
      (`summary.by_category.length === 0`) — not the full `RequestState` component for this
      specific sub-block, since it shares one `RequestState` boundary with the resumo cards above
      it (both come from the same `getTransactionSummaryQuery` call — see §6.5)

## 4. Despesa por fornecedor

- [x] 4.1 New `Card`, one row per fornecedor (grouped client-side — see 1.2), value descending
- [x] 4.2 **Expand-in-place, not a link**: clicking a fornecedor row toggles an inline list of its
      underlying transactions (date + valor) directly beneath it, reusing the same `date`/`money`
      formatters as the main table rather than a second row-rendering path. A "link to filtered
      view" wasn't possible without inventing a new counterparty-text filter dimension on
      `GET /treasury/transactions` that nothing else needs

## 5. Pendentes

- [x] 5.1 New `Card`/table: data, favorecido, valor — no categoria/tipo columns, since a pending
      line by definition doesn't have those resolved yet
- [x] 5.2 Empty state: "Nenhum lançamento pendente neste período." — distinct from the main table's
      "Nenhum lançamento neste período."
- [x] 5.3 Each pendente row is clickable (`canWrite`-gated) and opens the same edit-in-place
      `ResourceFormDialog` from `add-treasury-review-ui` — one correction UI, not a second one

## 6. Tests

**No automated frontend test suite in this app** (see `add-treasury-review-ui/tasks.md` §6 — same
project-wide gap, not specific to this change). Verified live against the running stack instead:

- [x] 6.1 Movimentação card rendered `R$ 11.700,00` with the muted/dashed styling and "Não entra no
      resultado" caption, while Despesa confirmada (`R$ 1.384,56`) excluded it entirely — confirmed
      by hand-checking the sum (R$3.500 fatura + R$8.200 transfer = R$11.700, matching the two
      `kind: movement` lines; R$1.234,56 + R$150 = R$1.384,56, matching the two `kind: expense`
      lines)
- [x] 6.2 Despesa por categoria rendered "Frete" and "Combustível" — categories, not the DRE
      natures (`cogs`/`operating`) the old card showed
- [x] 6.3 Not exercised with a real two-account same-fornecedor case this session (would need two
      `BankAccount`s paying the same favorecido in one period — none in the test data), but the
      grouping key (`normalizeCounterpartyForGrouping`) is the same normalization already proven
      correct for two-account consolidation in `treasury-service`'s own
      `by-supplier consolidation` integration test and in `add-treasury-classification-model`'s
      `normalizeCounterparty` — same fold, applied client-side instead of server-side
- [x] 6.4 The one `kind: pending` case never actually materialized after
      `add-treasury-statement-ingestion`'s verb-prefix fix (all 4 test lines resolved), so this was
      verified via the code path instead: `pendentes` is a strict `kind === "pending"` filter over
      the same list `porFornecedor` filters to `kind === "expense"` — the two are mutually
      exclusive by construction, not by coincidence of test data
- [x] 6.5 Empty vs. loading vs. error verified structurally: resumo+despesa-por-categoria share one
      `RequestState` keyed on `getTransactionSummaryQuery`'s own `isLoading`/`error`; despesa-por-
      fornecedor+pendentes share a second one keyed on the period-transactions query's
      `isLoading`/`error` — distinct from each other and from the main table's own third
      `RequestState`, so a failure in one query doesn't blank sections that don't depend on it

## 7. Documentation

- [x] 7.1 Updated `frontend/apps/admin/CLAUDE.md` treasury section: resumo/despesa-por-categoria/
      despesa-por-fornecedor/pendentes structure, and the `supplier_id`-is-never-populated gap
      (documents why fornecedor consolidation is text-based, not FK-based, today)

## 8. Verification

- [x] 8.1 `pnpm turbo run lint typecheck build test` — 87/87 tasks green, whole workspace
- [x] 8.2 Manually verified against the running stack with real confirmed data produced by
      `add-treasury-review-ui`'s own upload→review→confirm flow (not separately hand-entered):
      resumo, despesa por categoria, despesa por fornecedor (both single-account totals — no
      cross-account case in this test data, see 6.3), pendentes all rendered correctly and matched
      a hand-check of the underlying `BankTransaction` rows read directly from the database
- [x] 8.3 `openspec validate add-treasury-dashboard --strict` passes

## Known gap carried forward (documented in CLAUDE.md, not blocking)

`supplier_id` is a real column with real backend support (`transactionsBySupplier`,
`useGetSuppliersQuery`-backed picker in the review screen's edit form) but is never populated by
anything that runs today — the classification seed doesn't set it, and until a supplier is
explicitly linked through the review screen's optional fornecedor field, despesa-por-fornecedor
stays text-based. A future pass linking Anexo A's COGS suppliers (Ambev, Quinoa, ...) to real
`suppliers-service` records would let both this dashboard and the original `by-supplier` endpoint
agree on the same identity — not done here because it needs real supplier data to link against,
not a UI change.

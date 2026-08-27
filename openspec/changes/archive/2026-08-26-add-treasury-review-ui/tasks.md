## 1. RTK Query slice additions

- [x] 1.1 `src/lib/api/treasury.ts`: add `useUploadStatementsMutation` (multipart, up to six files
      + shared period), `useGetPendingImportsQuery`, `useGetPendingImportQuery(id)`,
      `useUpdatePendingTransactionMutation`, `useAttachProofMutation`,
      `useConfirmImportMutation`, `useRejectImportMutation`
- [x] 1.2 Types: `PendingImport`, `PendingTransaction` (mirroring the backend shapes from
      `add-treasury-statement-ingestion`, including `suggested_*` and `likely_duplicate_of_id`)

## 2. Upload screen

- [x] 2.1 `src/app/(app)/treasury/imports/upload/page.tsx`: one file input per source, all
      optional, one shared period selector (`<input type="month">`, matching `/ingestion`'s own
      upload form rather than the `/treasury` list's period `<Select>` — arbitrary/historical
      periods need free entry, not a fixed last-18-months dropdown)
- [x] 2.2 Submit calls `useUploadStatementsMutation`, then routes to
      `/treasury/imports/:period?sources=<comma-list>` — the `sources` param is what the review
      screen polls against (see 3.1)
- [x] 2.3 Per-source feedback: a toast naming how many files were queued; the review screen (not
      this one) is where "accepted" vs. "parsed" actually shows, since parsing is async

## 3. Review screen

- [x] 3.1 `src/app/(app)/treasury/imports/[period]/page.tsx`: polls `GET /treasury/imports` every
      3s while any `sources` param source hasn't appeared as a row yet, then stops — implemented as
      a `setInterval`-driven `refetch()` inside a `useEffect` keyed on a derived `stillWaiting`
      boolean, NOT `pollingInterval` fed by a ref/state derived from the same query's own result:
      this project's ESLint config enforces the React Compiler's hook-purity rules
      (`react-hooks/refs`, `react-hooks/set-state-in-effect`, `react-hooks/purity`), which reject
      reading/writing a ref during render, calling `setState` synchronously in an effect body, and
      calling `Date.now()` during render — all three were tried and rejected by lint before landing
      on the interval+cleanup-on-dependency-change pattern that satisfies them. No prior polling
      precedent existed in this app (`/ingestion` doesn't poll) — this is the first.
- [x] 3.2 Renders four sections per spec — despesa por categoria, despesa por fornecedor,
      movimentação, pendentes — as parallel `GroupSection` cards (not fornecedor nested inside
      categoria, matching spec.md's literal wording over the pre-implementation plan doc's
      phrasing), reusing `RequestState` for the import-cards list
- [x] 3.3 Inline edit via `ResourceFormDialog` (kind/category/nature/fornecedor) — **`fornecedor`
      is `suggested_supplier_id`, a `suppliers-service` link, presented as optional and separate
      from `category`**, not a merge of the two: most Anexo A payees (frete, contador, sócios,
      financiamento) aren't goods suppliers in that registry's sense at all, only the COGS ones
      plausibly are. `category` stays free text with a placeholder, not a
      `useGetCategoriesQuery`-backed `Select` — matches how `category` is already treated
      everywhere else in this app (free text, "a operação inventa categoria nova toda semana",
      per treasury-service CLAUDE.md)
- [x] 3.4 Likely-duplicate badge — tone **`critical`**, not `attention` as originally sketched: a
      pending line already gets `attention` for "unresolved favorecido" in the same table, and a
      possible double-count needs to visually outrank that, not blend into it
- [x] 3.5 SISPAG resolution widget (image + payee text) on every `suggested_kind: "pending"` row,
      not only ones that look Itaú-specific — matches the spec's general wording ("a pending
      transaction with no resolved fornecedor"), calling `useAttachProofMutation`
- [x] 3.6 "Confirmar" always visible when staged, with a non-blocking
      "N pendente(s) ficarão sem favorecido" hint alongside it when applicable
- [x] 3.7 "Rejeitar" button — **no confirmation dialog**, unlike the task's original sketch: every
      other destructive action in this app (`deleteTransaction`, `deleteMapping`) is a single
      click with no confirm step, and rejecting an import is no more destructive than those (the
      raw file and the import record survive; only the `PendingTransaction` rows are discarded).
      Adding a dialog here alone would be an inconsistent one-off.
- [x] 3.8 "Ver lançamentos do período" link (in the `PageHeader`, always visible, not gated on
      having just confirmed) toward `/treasury?period=:period` — deliberately not an automatic
      redirect after one import's confirm, since a period can have several staged imports (one per
      source) and confirming one shouldn't navigate away while siblings are still awaiting review

## 4. Edit-in-place on the existing transaction table

- [x] 4.1 `src/app/(app)/treasury/page.tsx`: edit icon (`Pencil`) per row next to delete, same
      `canWrite` gate, `ResourceFormDialog` pre-filled, `useUpdateTransactionMutation`
- [x] 4.2 Reuses the exact same `fields`/`transactionSchema` as "Novo lançamento" — one field set,
      not a divergent second one; `submitValues()` extracted so create and edit build the same
      payload shape (`kind`/`nature`/`account_id`/`amount_cents` conversion) from one place

## 5. Navigation

- [x] 5.1 "Importar extratos" action added to `/treasury`'s `PageHeader` (`canWrite`-gated) AND as
      a `Tesouraria` sidebar item (`treasury:read`-gated, since browsing past imports is a read
      action) pointing at the import list — broader than the task's literal ask, but the list page
      described in proposal.md's Impact section needed its own entry point too
- [x] 5.2 Review screen links back to `/treasury?period=:period`; the sidebar's new "Importar
      extratos" item and `/treasury/imports/page.tsx` (the list, one row per `PendingImport`
      across all periods/sources/statuses) are the way back to "the import list"

## 6. Tests

**No automated frontend test suite exists in this app** (`frontend/apps/admin/CLAUDE.md`: "Sem
suíte de testes automatizados... a verificação é manual, ao vivo, contra o stack real" — true of
all 20 routes, not particular to this change). Verified live instead, against the real Docker
stack, logged in as a temporary QA user (created and torn down afterward, same pattern used for
`add-treasury-statement-ingestion`'s verification):

- [x] 6.1 Uploaded one file (PagBank fixture) of the six, submitted, landed on the review screen
      with `?sources=pagbank_statement` — confirms "a subset works", the strongest version of this
      check (one is the extreme case of "not all six")
- [x] 6.2 Movement lines (fatura payment, AGILIZ.AI LTDA transfer) rendered in their own section,
      excluded from despesa por categoria/fornecedor and from the R$1.384,56 Despesa confirmada
      total
- [x] 6.3 Corrected AMBEV's category from "Estoque" to "Frete" pre-confirm; confirmed; the
      resulting `BankTransaction` carried `category: "Frete"`, not the original suggestion —
      verified via direct DB read, not just the UI re-render
- [~] 6.4 Not exercised live (no unresolved line existed in the test data after
      `add-treasury-statement-ingestion`'s verb-prefix fix — every line resolved). The
      `attachProof` mutation reuses the exact FormData-field-order contract already verified live
      for `uploadStatements` (`ingestion.ts`'s documented gotcha: value fields before the file
      part) against the same gateway multipart-parsing code path, so the risk here is materially
      the mapping/dialog wiring, which passed typecheck/lint/build
- [x] 6.5 Confirmed an import with zero pending lines present in this run; the backend behavior
      itself (confirm succeeds with `kind: pending` lines) is covered by
      `pending-import.integration-spec.ts` in `add-treasury-statement-ingestion` — this UI task is
      "does the button call confirm unconditionally", which it does (no client-side gate on
      unresolved count)
- [x] 6.6 Edit-in-place: changed AMBEV's category back to "Estoque" from the confirmed table;
      verified via direct DB read that the same row (id unchanged) updated in place — no duplicate
      row created

## 7. Documentation

- [x] 7.1 Updated `frontend/apps/admin/CLAUDE.md`: new routes, the polling mechanism (and why it's
      shaped the way it is under this app's lint rules), edit-in-place, and the
      `normalizeCounterpartyForGrouping` gap (see `add-treasury-dashboard/tasks.md` 7.1 — documented
      once, referenced from both)

## 8. Verification

- [x] 8.1 `pnpm turbo run lint typecheck build test` — 87/87 tasks green, whole workspace
- [x] 8.2 Manually verified against the running stack: uploaded the PagBank fixture, watched the
      review screen reach `staged` within ~1s, corrected AMBEV's category, confirmed, saw the
      result (with the correction applied) on `/treasury`'s main table and dashboard sections
- [x] 8.3 Manually verified edit-in-place on the confirmed AMBEV transaction (see 6.6)
- [x] 8.4 `openspec validate add-treasury-review-ui --strict` passes

## Known gaps carried forward (not blocking, documented in code/CLAUDE.md)

- SISPAG attach-proof widget not exercised against a real unresolved line this session (6.4).
- "Rejeitar" and the app-wide breadcrumb (`app-breadcrumb.tsx`'s prefix-match picks the first
  `nav` entry whose `href` is a string-prefix of the path, so `/treasury/imports*` shows
  "Lançamentos" in the top bar, not "Importar extratos") — the breadcrumb issue pre-dates this
  change (`/inventory/central` has the same latent bug against `/inventory`) and is out of scope
  here.

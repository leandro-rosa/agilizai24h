## Why

`add-treasury-statement-ingestion` builds the pipeline that turns six monthly bank/card files into
classified pending transactions — but nothing in the admin panel lets finance upload those files or
see what the system understood before it counts. Finance's explicit requirement from the
requirements handoff was a mandatory review step: "conferir antes de confirmar" — never automatic.
This change is that screen, plus the one gap the current `/treasury` page has that finance also
flagged: a confirmed lançamento can only be created or deleted today, never corrected in place.

## What Changes

- **A batch upload screen** on `/treasury`: six file inputs (one per source), all optional, one
  submission per month — matching finance's confirmed preference for uploading everything together
  rather than source-by-source.
- **A review screen** per pending import (or per period, covering every source uploaded for it):
  groups pending transactions the same way finance thinks about them — despesa by categoria, despesa
  by fornecedor, movimentação (informational), pendentes — using each line's *suggested*
  classification from `add-treasury-statement-ingestion`.
- **Inline correction** on the review screen: change a pending line's kind/category/nature/
  fornecedor before confirming.
- **The Itaú SISPAG resolution widget**: on a pending line with no resolved payee, attach a
  comprovante image and type who was paid, right there — the workflow finance specifically asked
  for over the alternative (resolving it externally first, or leaving it pending).
- **A likely-duplicate warning** on any pending line flagged by the backend as matching an
  already-confirmed transaction (re-upload-after-confirm case).
- **"Confirmar" and "Rejeitar"** actions per import/period, calling the confirm/reject endpoints.
- **Edit-in-place on the existing transaction table**: a confirmed `BankTransaction`'s
  kind/category/nature/fornecedor becomes editable through `ResourceFormDialog`, using the
  `PATCH /treasury/transactions/:id` endpoint that already exists but has no UI calling it today.

Out of scope: the redesigned summary/dashboard sections (resumo cards, despesa por categoria,
despesa por fornecedor, pendentes list) — that is `add-treasury-dashboard`, reading confirmed data
this change produces.

## Capabilities

### New Capabilities

- `treasury-review-ui`: the operator-facing upload and review workflow — submitting the monthly
  files, seeing and correcting what the system understood, resolving an unidentified Itaú payee,
  and confirming or rejecting an import — plus editing an already-confirmed transaction.

### Modified Capabilities

None.

## Impact

- **Modified**: `frontend/apps/admin/src/app/(app)/treasury/page.tsx` — adds the upload trigger and
  a link/section into the review flow; adds an edit action (reusing `ResourceFormDialog`,
  `useUpdateTransactionMutation`) to the existing transaction table.
- **New**: `frontend/apps/admin/src/app/(app)/treasury/imports/` — the review screen(s): import
  list, import/period detail with grouped pending transactions, the Itaú attach-image widget
  (file input + text field, uploaded via the existing upload pattern to object storage).
- **Modified**: `frontend/apps/admin/src/lib/api/treasury.ts` — RTK Query endpoints for the batch
  upload, import list/detail, pending-transaction edit, proof attachment, confirm/reject.
- **Depends on**: `add-treasury-statement-ingestion`'s staging API and `add-treasury-
  classification-model`'s `kind`/category taxonomy for how corrections are presented.
- **User-visible**: this is finance's primary new workflow — the spreadsheet-replacement moment the
  whole requirements conversation was about.

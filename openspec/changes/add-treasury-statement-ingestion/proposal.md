## Why

Finance's monthly reconciliation is done by hand today: read the PagBank, C6, Nubank, Bradesco
and Itaú statements plus the C6 card invoice, and apply the classification rules `treasury`
(`add-treasury-classification-model`) now models, one lançamento at a time, in a spreadsheet. The
whole point of the requirements handoff was to replace that spreadsheet: finance uploads the six
raw files for a month, the system applies the rules automatically, and finance reviews the result
before it counts — rather than typing every lançamento into `/treasury` by hand through
`ResourceFormDialog`.

This change is the pipeline: accept the six files, extract their lines, and turn them into
`kind`/`category`/`nature`-classified pending transactions awaiting confirmation. It does not
build the screen finance reviews them on (`add-treasury-review-ui`) or the resulting dashboard
(`add-treasury-dashboard`) — it builds what those two changes read from and write to.

## What Changes

- **A monthly import accepts six files in one submission**: extrato PagBank (PDF), extrato C6
  (PDF), fatura do cartão C6 (PDF), extrato Nubank (PDF), extrato Bradesco (CSV), extrato Itaú
  (PDF). Any subset may be submitted — finance does not always receive every file the same day.
- **Per-source parsing** extracts raw lines (date, raw description/counterparty text, amount,
  direction where determinable, and — for the C6 invoice — whether the line is a compra or a
  pagamento) from each file's actual format. PDF parsing is text-layer extraction (the statements
  are generated, not scanned); Bradesco's CSV is column-mapped.
- **Itaú's `SISPAG PAGAMENTO DE FORNECEDOR` lines carry no payee name in the statement.** They are
  extracted as `pending`, with no attempt to guess a fornecedor — resolving them is a manual step
  in the review UI (attach a comprovante image + type the payee), not something this change's
  parser can do.
- **Extracted lines run through `treasury`'s classification engine** (mapping resolution, own-
  entity detection, keyword rules) as soon as they're parsed, producing a *suggested*
  classification — never written as a real `BankTransaction` until a human confirms the import.
- **A staging model**: `PendingImport` (one per upload batch) and `PendingTransaction` (one per
  extracted line, carrying its suggested classification and, for Itaú SISPAG lines, an attachable
  proof-of-payment image). Confirming an import converts its `PendingTransaction` rows into real
  `BankTransaction` rows in one batch; rejecting an import discards them, keeping the original
  files.
- **Re-uploading a source for an account+period already staged replaces that source's pending
  lines**, not appends to them — the same idempotency contract `ingestion-worker-service` already
  uses for sales/supply.
- **The same pipeline serves historical backfill**: uploading a past month's files works
  identically to the current month.

Out of scope for this change: the review/confirm UI screen, and the redesigned `/treasury`
dashboard.

## Capabilities

### New Capabilities

- `treasury-ingestion`: accepting the six monthly source files, extracting their lines per
  source's actual format, auto-classifying each line via the `treasury` capability's rules, and
  staging the result for confirmation — including the Itaú SISPAG manual-resolution path and
  same-source idempotent re-upload.

### Modified Capabilities

None.

## Impact

- **New**: `backend/apps/treasury-service` gains `PendingImport`/`PendingTransaction` Prisma
  models, staging endpoints, and (new for this service) a registered `HoldItModule`
  (`WITH_KAFKA_BROKERS=false`) to consume parsed rows asynchronously.
- **Modified**: `backend/apps/ingestion-worker-service` — a fourth sink family (treasury), five new
  PDF parsers plus one CSV parser, each its own queue per `add-ingestion-flow`'s established
  one-queue-per-file-type pattern; a new `@app/ingestion-contracts`-style payload for treasury rows
  (or an equivalent contracts addition — see design.md).
- **Modified**: `backend/apps/gateway-service` — a batch-upload route accepting up to six files,
  and read routes for pending imports/transactions.
- **New dependency**: PDF text extraction. No library in the workspace does this today (confirmed
  — only `@app/sheeter` for spreadsheets exists); design.md picks one.
- **New dependency**: object storage for the Itaú comprovante image attachment, via the existing
  `@app/aws` `S3Service` (same bucket pattern as raw uploaded files).
- **Depends on**: `add-treasury-classification-model` (the `kind`/mapping/own-entity/keyword engine
  this change calls immediately after parsing).
- **Enables**: `add-treasury-review-ui` (the screen operators use to inspect and confirm what this
  change staged) and, indirectly, `add-treasury-dashboard` (which only shows confirmed data).

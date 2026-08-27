## Context

See `proposal.md` — Why. The established pattern for turning an uploaded file into normalized
records already exists in `ingestion-worker-service` (`add-ingestion-flow`, archived): gateway
stores the raw file via `@app/aws`'s `S3Service`, calls the worker over HTTP, the worker records
an `Ingestion` and queues a parse job via `@app/hold-it`; one queue per file type; a structural
mismatch fails the whole file, a bad row is rejected-and-reported rather than skipped; a period's
rows are accumulated and handed to the owning service as one replacement batch, never streamed
row-by-row, so a multi-chunk file can't leave a period half-written.

What's different here: today's three sinks (`sales`, `supply`, `products`) finalize automatically
— the moment parsing completes, the batch replaces the period. Finance's explicit requirement
(from the handoff conversation) is a review gate: nothing counts until a human has seen what the
system understood and confirmed it. No existing ingestion path has this. `treasury-service`
(`add-treasury-classification-model`) owns the `kind`/mapping/own-entity/keyword classification
engine this change must call on every extracted line, and has no queue registered today.

No PDF-parsing capability exists anywhere in the workspace — confirmed by search; only
`@app/sheeter` (spreadsheet/CSV) exists. Five of the six sources are PDF.

## Goals / Non-Goals

**Goals:**

- Reuse the existing queue-per-file-type, staged-rows, reject-and-report pattern wherever it
  still fits, rather than inventing a parallel ingestion mechanism.
- Make the one genuinely new piece — the review gate — a clean, explicit state machine
  (`staged → confirmed | rejected`), not a bolt-on flag on the existing `Ingestion` model.
- Never silently guess: an unparseable line, an unresolvable Itaú SISPAG payee, or an amount that
  doesn't parse is reported, never dropped or zeroed (same principle `add-ingestion-flow` already
  established for sales/supply).

**Non-Goals:**

- No OCR or automated extraction of the Itaú comprovante image — it is a manual attachment plus a
  typed payee name in the review UI (`add-treasury-review-ui`), not something this change's parser
  produces.
- No automatic confirmation. Every import waits for a human regardless of how confident the
  classification is.
- No cross-period matching (a devolução from a different month than its saída is out of scope —
  `treasury`'s neutralization requirement is already same-month-only).
- No review/confirm screen — this change's surface is the API and the pipeline; the screen is
  `add-treasury-review-ui`.

## Decisions

### D1 — PDF text extraction via `pdf-parse` (text layer, not OCR)

The five PDF sources are bank-generated, not scanned — they have a real text layer. `pdf-parse`
(thin wrapper over `pdfjs-dist`) extracts that text; per-bank line parsing then runs regex against
the extracted lines, matching the exact line shapes finance's rules document already names
verbatim ("Cartão PagBank - Pagamento de Fatura", "PGTO FAT CARTAO C6", "SISPAG PAGAMENTO DE
FORNECEDOR", ...) — those strings are only knowable because they extract cleanly as text today.

*Alternative considered:* `pdfjs-dist` directly, reading each text run's x/y position to
reconstruct table rows by column. More robust to a statement whose layout interleaves columns in
an order plain text extraction would scramble, but meaningfully more code for a need not yet
demonstrated. If real fixtures (task 7) show line-based regex misreads a bank's layout, this is the
fallback — `pdf-parse` sits on top of `pdfjs-dist`, so dropping to positional extraction for one
bank's parser does not require replacing the library.

### D2 — Money parsing is dedicated and tested against the known "-R$" bug

Finance's own bug log names a real failure: "-R$" with no space between the sign and the currency
mark was not captured by their original extraction. This change's amount parser is one shared
function per PDF source (not one regex improvised per line-type), with the concatenated-sign case
as a named test fixture from day one — the bug is in the historical record precisely so it is not
repeated silently.

### D3 — `treasury-service` gains a queue, `ingestion-worker-service` gains a fourth sink family

Six new queues in `ingestion-worker-service` (one per source: pagbank-statement, c6-statement,
c6-invoice, nubank-statement, bradesco-statement, itau-statement), mirroring `add-ingestion-flow`'s
D1 (one queue per file type, never a generic parse queue — the six sources share no schema any
more than sales/restock/cost did). Each worker parses its source's raw lines and hands them to
`treasury-service` via `@app/hold-it`, which is the first time this service registers
`HoldItModule` (`WITH_KAFKA_BROKERS=false`, per the standing workspace gotcha).

*Why hand off to `treasury-service` rather than have `ingestion-worker-service` write
`PendingTransaction` rows directly:* the classification engine — mapping resolution, own-entity
detection, keyword rules, neutralization candidates — is `treasury-service`'s owned logic
(`add-treasury-classification-model`). Writing classified rows from `ingestion-worker-service`
would mean either duplicating that logic in a second service or having
`ingestion-worker-service` call back into `treasury-service` synchronously mid-parse, which the
project's async-processing rule argues against. `ingestion-worker-service`'s job stays exactly what
it already is elsewhere: turn a file's raw lines into structured data and hand them to the owning
service — nothing about the file format belongs in `treasury-service`, nothing about
classification belongs in the parser (mirrors `add-ingestion-flow`'s D3, applied to this domain).

### D4 — The review gate is a `PendingImport` state machine, not a flag on `Ingestion`

New models, owned by `treasury-service` (not `ingestion-worker-service`, which owns generic
`Ingestion`/`StagedRow` for its three existing sinks):

- `PendingImport`: one row per upload batch — `period`, `source` (one of the six), `status`
  (`staged | confirmed | rejected`), counts, timestamps.
- `PendingTransaction`: one row per extracted line, FK to `PendingImport`, carrying the same
  shape a `BankTransaction` will have plus `suggested_kind`/`suggested_category`/
  `suggested_nature`/`suggested_supplier_id` (the classification engine's output) and
  `proof_object_key` (nullable, for the Itaú attachment).

*Why not extend `ingestion-worker-service`'s `Ingestion`/`StagedRow`:* those models' whole shape
assumes auto-finalize (`processed_chunks >= expected_chunks` triggers immediate handover). Bolting
a review gate onto that state machine would mean two very different life cycles sharing one table,
for a set of fields (`suggested_*`, `proof_object_key`) that only ever apply to treasury. A second,
purpose-built model in the service that actually owns the review workflow is the smaller change.

### D5 — Confirming converts pending rows to real transactions in one batch, per source

`POST /treasury/imports/:id/confirm` writes every non-rejected `PendingTransaction` in that import
as a real `BankTransaction` (using its — possibly reviewer-edited — classification) in one
transaction, then marks the `PendingImport` `confirmed`. This mirrors `add-ingestion-flow`'s D5
(accumulate, then hand over once) for the same reason: a partially-confirmed import must not leave
some of a source's lines counted and others not.

### D6 — Re-uploading a source: replace while staged, add-and-flag once confirmed

Re-uploading a source for an account+period whose `PendingImport` is still `staged` replaces that
import's `PendingTransaction` rows (same idempotency contract sales/supply already have — the
"corrected file supersedes" behavior). Re-uploading a source whose import for that account+period
was already `confirmed` creates a **new** `PendingImport` instead of touching the confirmed
`BankTransaction` rows; each of its lines is checked against already-confirmed transactions in that
account+period (same date, same amount, same normalized counterparty) and flagged
`likely_duplicate` for the reviewer, rather than the system silently skipping or silently
duplicating. Deleting or replacing an already-confirmed transaction stays the edit-in-place
capability `treasury` already provides (`add-treasury-classification-model`), not something a
re-upload does automatically.

*Why not block re-upload after confirmation outright:* finance's stated workflow includes bringing
in historical months and correcting a wrong file is a real, named need — forcing every correction
through one-row-at-a-time editing when a whole file was wrong (e.g., uploaded the wrong month's PDF)
would be worse than a flagged, reviewable second batch.

### D7 — A pending line can be confirmed as `kind: pending`; nothing blocks confirmation

An import can be confirmed even while some of its lines carry no resolved classification (Itaú
SISPAG without an attached image yet, or any other unresolved favorecido) — they become real
`BankTransaction` rows with `kind: pending`, which is already a first-class, dashboard-visible state
(`add-treasury-classification-model`). This change's API does not force resolution before
confirmation; `add-treasury-review-ui` is where the UI nudges the reviewer to resolve what she can
first, as a UX choice layered on top of a backend that does not need to enforce it.

### D8 — Bradesco's CSV is a plain column-mapped parse

Unlike the five PDFs, Bradesco arrives as CSV — no text-extraction ambiguity. Columns map directly
to date/description/amount/direction, following the same "reject a row that doesn't match the
expected shape, never guess" principle as every other parser here.

**Superseded by D9**: the real file is `.xlsx`, not CSV — D8's premise was wrong. Left here as
historical record of the original (unmeasured) assumption; D9 is the correction.

### D9 — Real files (provided by finance, 2026-08-26) invalidated almost every line-shape
assumption; parsers rewritten against measured text, not guessed shape

Every parser in this change was built against an assumed line shape (documented in the "Gaps
conhecidos" this change's own CLAUDE.md entries carried from day one — "nenhum arquivo real foi
usado", "layout não medido"). Real files now exist. Measuring them (via the same `pdf-parse`
call the production code makes, not `pdftotext`, which reorders columns for these specific PDFs)
found:

- **PagBank**: matches assumptions. Only fix: `stripKnownPrefix` (shared, `statement-line.ts`)
  leaves a stray `"- "` before the counterparty, because it slices the RAW token array by the
  NORMALIZED prefix's token count, and a raw token that's pure punctuation (a lone `"-"`)
  normalizes to nothing — raw/normalized token counts silently misalign. Bug in the shared
  function, not PagBank-specific; any future source with a dash-joined prefix would hit it too.
- **C6 statement**: real lines are tab-separated with the Tipo (Entrada/Saída PIX, ...) as its own
  column, not text glued onto the description — `VERB_PREFIXES` was solving a problem the real
  file doesn't have. The date is `DD/MM` with **no year**, twice per line (lançamento/contábil);
  year only appears on a `"Mês AAAA"` section header. `parseStatementLines`'s
  `LINE_DATE_PATTERN` requires `DD/MM/YYYY` — never matches, so this parser has always produced
  zero rows against a real C6 statement. Rewritten as its own tab-splitting loop (leaves
  `parseStatementLines`, doesn't extend it), carrying "current year" as state updated by the
  section header, excluding `"Saldo do dia DD/MM/YY"` (2-digit year, distinguishable from a
  transaction date by the trailing balance amount having no Tipo/Descrição columns before it).
- **C6 invoice**: date is `DD mmm` (`"01 abr"`) — no slashes, no year, anywhere near a purchase
  line, and none in the PDF's own metadata either (checked `CreationDate`; it's the issuance date,
  not reliably the transaction month). Amount is bare — `R$` only appears on card-level subtotals.
  Year resolved from the uploader-supplied `period` via a rollover rule (parsed month "after" the
  period's month by more than ~1 ⇒ previous year), since no more reliable source exists in the
  document.
- **Itaú**: `R$` appears twice in the whole document, never on a transaction line — the existing
  `findMoneyInText` (which mandates `R$`) rejects every real line before the correct `SISPAG`
  structural patterns (confirmed textually correct against 47 real occurrences) ever get a chance
  to fire. Separately, a long razão social pushes the CNPJ and amount onto a second physical line
  with no date — needs a one-line lookahead join (if a dated line has no amount and the next line
  doesn't itself start with a date, concatenate before parsing) *in addition to* the bare-amount
  fix, not instead of it.
- **Nubank**: the most divergent. No `R$` on any transaction line, no per-transaction date (only
  on a day-header, `"DD MMM AAAA"`), and a real record spans 3-5 physical lines. Measured further:
  the closing amount never itself carries a sign — direction comes from a sub-header
  (`"Total de entradas + X"` / `"Total de saídas - Y"`) that can appear **more than once within
  the same day** (entradas first, then saídas partway through), so state is (current day, current
  direction), not just current day, and a day's transaction lines can be split across a `pdf-parse`
  page boundary (measured directly: a record's description ended one page, its detail+amount
  started the next) — state must survive the outer page loop, not reset per page like every other
  parser here does today.
- **Bradesco**: real file is `.xlsx` (confirmed binary, opens in Excel/openpyxl), not CSV text —
  D8 was simply wrong about the file format, not just the columns. Real structure: header on row
  9 (rows 1-8 are account boilerplate), two signed value columns (Crédito/Débito, not one `Valor`),
  a `SALDO ANTERIOR` opening-balance row, a `Total` footer row, and a second, differently-shaped
  table stacked below the first (`"Saldos Invest Fácil"`, its own header, 34 rows of balance
  snapshots — not movements). Rewritten to reuse
  `src/modules/ingestion/utils/read-workbook-rows.ts`'s `readWorkbookRows` (already used by the
  sales/supply/cost pipeline; ExcelJS with a SheetJS fallback, returns a plain row matrix) instead
  of `csv-parse`, and to locate its header by searching a window rather than assuming row 1 — same
  *technique* `locate-restocking-operations.ts` already uses for a stacked-table sheet in this same
  app, not the same code (that file's column vocabulary is restocking-specific).
- **A seventh source exists**: the PagSeguro/PagBank card invoice (`fatura pagseguro`) is a
  genuinely distinct source from the PagBank checking-account statement — nothing in this change
  ever claimed it, and no parser/queue/BankAccount for it exists. Its line shape is inverted from
  every other source: description, bare amount, **date at the end** of the line. Added as a
  seventh `TreasurySource` (see D11) rather than folded into `pagbank_statement`, since it really
  is a different file with a different account (same institution, `credit_card` kind vs.
  `checking`) and a different upload field.

Real files stay local and gitignored (`var/` — confirmed already ignored); this is the company's
real financial data (real vendor names, real amounts, partial real account/CNPJ numbers) and is
used only for interactive validation during development. What ships in the repo is a synthetic,
structurally-faithful fixture per source (same convention `test/fixtures/treasury/README.md`
already states for the original PagBank fixture, extended to the other five/six).

### D10 — Itaú's line-join and Nubank's block-assembler are separate implementations, not a
shared "multi-line record" utility

Itaú's shape is a fixed one-line lookahead triggered by a single condition (dated line, no
amount) — a preprocessing join that turns N lines into N-or-fewer before the existing per-line
extraction runs almost unchanged. Nubank's shape is a genuine state machine: a day/direction pair
that persists across an unbounded number of variable-length blocks, where the block boundary
itself is content-shaped (a line that is nothing but a bare number closes it) and role assignment
(first line vs. last line vs. everything between) has no equivalent in Itaú's problem. Forcing
both through one parameterized function now — before Nubank's exact boundary rules were even
confirmed against real text — risks either an over-general abstraction only one caller uses, or a
mid-implementation discovery that doesn't fit whatever shape got locked in first. Mirrors a
decision already live in this codebase: `locate-restocking-operations.ts` reuses the *technique*
of `read-workbook-rows.ts` without being forced through one generic function. What genuinely is
shared (D9): the bare-BRL-amount matcher and the PT-month-abbreviation lookup — both narrow,
unambiguous, and needed verbatim by more than one source, unlike the block-assembly logic.

### D11 — PagSeguro/PagBank card invoice is a seventh `TreasurySource`

`TREASURY_SOURCES`/`TREASURY_SOURCE_QUEUES` (`@app/treasury-ingestion-contracts`) gain a seventh
member. Traced every place the six-source enumeration is hardcoded rather than derived from the
contract, so this task list is exhaustive, not best-effort: `app.module.ts`'s `HoldItModule.
registerWorker({ processors })` array (a real hardcode — queue names in `HoldItModule.register`
already derive from `Object.values(TREASURY_SOURCE_QUEUES)`, but the worker-class list does not);
`treasury-service`'s seeded `BankAccount` table (new row, `institution: 'pagbank'` —
same institution as the checking-account statement, confirmed by the invoice's own cardholder
name being personal ("Barbara"), not a separate razão social — `kind: 'credit_card'`, mirroring
how C6 already has two accounts for the same institution); the frontend's three
`Record<TreasurySource, ...>` maps in `src/lib/api/treasury.ts`. Explicitly NOT touched: the
gateway's upload controller (`TREASURY_SOURCES.includes(...)` and the `${source}_account_id`
field name are already generic over the contract) and `create-treasury-source.dto.ts`'s
`@IsIn(TREASURY_SOURCES)` (same reason). The upload form's per-source zod fields stay written
explicitly (matching this file's own established convention — no other form in this app
generates a schema dynamically), so the new source's two fields are added by hand like the other
six, not derived.

**Corollary bug found live while shipping this**: "not touched" above (the gateway needing no
code change to route the new source) was true, but exercising it live against a gateway build
that DIDN'T yet know `pagseguro_invoice` uncovered a real, general bug in
`TreasuryImportsController.upload()`: an unrecognized multipart file field was skipped via a bare
`continue`, never draining its stream — `@fastify/multipart` blocks the whole request forever
(no response, no error) until every file part's stream is consumed, recognized or not. Fixed with
`part.file.resume()` before the `continue`. This wasn't specific to this source landing late; any
future unrecognized field (typo, stale client) would hang identically. See gateway-service
CLAUDE.md for the full writeup.

## Risks / Trade-offs

- **A bank changes its statement's text layout** → the line-shape regex stops matching → every
  line from that file is rejected-and-reported (never silently zeroed), the same graceful failure
  `add-ingestion-flow` already relies on for a structural mismatch.
- **Text-only PDF extraction could interleave columns on a layout not yet seen** → mitigated by
  testing against real fixtures per source before considering a parser done (task 7), with D1's
  positional-extraction fallback available per-bank if needed, without a library change.
- **A `PendingImport` left `staged` indefinitely** (uploaded, never reviewed) → visible in the
  import list by status; no automatic expiry in this change — finance's own workflow (upload then
  immediately review, per the handoff conversation) makes a long-lived stale import an edge case,
  not the common path.
- **Six new queues is a lot of moving parts for a monthly, low-volume (hundreds of lines) job** →
  accepted: the alternative (one generic treasury-parse queue branching internally by source) was
  already rejected once in this codebase for the same reason (`add-ingestion-flow` D1) and nothing
  about treasury's case is different.

## Migration Plan

1. `treasury-service`: add `PendingImport`/`PendingTransaction` models and migration (additive, no
   existing table touched); register `HoldItModule`.
2. `ingestion-worker-service`: add the six parsers and queues, one source at a time — each is
   independently testable against its own real fixture file before the next is started.
3. `gateway-service`: add the batch-upload route last, once every parser it could route to exists
   — mirrors `add-ingestion-flow`'s deploy-order note (no upload accepted before something can
   process it).
4. Deploy order: `treasury-service` migration → `ingestion-worker-service` (new queues) →
   `gateway-service` routes.
5. Backfill of historical months is the same upload operation with a past period — no separate
   mechanism, per the requirements handoff's explicit ask.

## Open Questions

- Retention policy for the raw uploaded bank/invoice files in object storage — deferrable, same
  open question `add-ingestion-flow` already left open for sales/supply; no reason treasury's
  answer would differ, and it doesn't change this change's approach or task breakdown.

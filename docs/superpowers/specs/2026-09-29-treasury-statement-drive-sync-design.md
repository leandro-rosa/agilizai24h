# Treasury statement Drive sync — design

## Context

Sales and abastecimento reports already sync from Google Drive
(`add-drive-ingestion-source`): a worker scans a configured folder every
morning (or on a manual "Sincronizar agora" click), detects the file's
format, and lists it in `/ingestion`'s "Arquivos no Drive" section for the
operator to review and import with one click. Bank statements and credit
card invoices — 7 sources (PagBank, C6 extrato, C6 fatura, PagSeguro
fatura, Itaú, Nubank, Bradesco) — have no such thing: every month the
operator manually uploads up to 6 files through `/treasury/imports/upload`.

The operator now keeps these statements in a second Drive folder
("Extratos", id `1m-79pKJqmE7nL9enlLb_ncAFHe7BBccq`), organized as
`<mês>/<banco>/<arquivo>`, and wants the same "drop it in Drive, click
sync in the panel" experience she already has for sales/abastecimento,
instead of asking Claude to run the import by hand every month.

**What the real folder looks like today** (confirmed live, 2026-09-29, via
the same service account already configured for
`GOOGLE_DRIVE_ROOT_FOLDER_ID`, which already has Reader access to this
folder too):

```
Extratos/
  agosto/
    itau/
      comprovantes itau/          <- WhatsApp screenshots, noise
      Entradas_Saidas_ag2059cc996765_15-09-26   (Google Sheet)
    c6/
      extrato c6 agosto            (Google Sheet)
      Fatura_2026-09-01            (Google Sheet)
  <legacy items — never scanned, see "Which folders count as a month">
```

Only `agosto/itau` and `agosto/c6` have real files today; the other 5
sources (Nubank, PagBank, Bradesco, PagSeguro fatura) haven't appeared in
this folder yet. **This design scopes to those two — Itaú statement, C6
statement, C6 invoice — and is built so adding a new source later is a
small, well-understood increment, not a redesign.**

**The files are native Google Sheets, not PDF or CSV** — and their layout
does not match what the existing 7 PDF-based parsers expect at all:

- `itau/Entradas_Saidas_...`: has the same header block a real Itaú PDF
  extrato has (Atualização/Nome/Agência/Conta/Período), then a
  "Lançamentos" section — structurally analogous to the PDF, but as real
  cells, not extracted text. The existing `itau.parser.ts` (built for
  `pdf-parse` text) cannot read this.
- `c6/extrato c6 agosto`: clean header row —
  `Data Lançamento, Data Contábil, Título, Descrição, Entrada(R$), Saída(R$), Tipo, Detalhe`
  — nothing like the tab-separated PDF-text format `c6-statement.parser.ts`
  parses today.
- `c6/Fatura_2026-09-01`: clean header row —
  `Data de Compra, Nome no Cartão, Final do Cartão, Categoria, Descrição, Parcela, Valor (em US$), Cotação (em R$), Valor (em R$), Tipo, detalhe`
  — also nothing like `c6-invoice.parser.ts`'s PDF format.

So this is not "wire Drive to the 7 existing parsers" — it's 3 new parsers
for a genuinely different (and more reliable — real cells, not PDF text
extraction, which has a real history of subtle bugs in this exact codebase:
Nubank's page-boundary line duplication, Itaú's multi-line continuation
joins, PagSeguro/C6 invoice lookahead) source format, landing on the exact
same downstream queue the 7 PDF parsers already feed.

## Goals

- Scan `Extratos/<mês>/{itau,c6}/` (from "agosto" onward), detect Itaú
  statement / C6 statement / C6 invoice files by content signature, list
  them for the operator with the same "new/changed, review, confirm,
  import" flow sales/abastecimento already has.
- A "Sincronizar agora" button, plus the same 06:00 America/Sao_Paulo
  scheduled scan already used for sales/abastecimento (its own cron
  instance — separate schedule, not shared state).
- New rows land in `treasury-service` through the exact same
  `treasury.raw-rows` queue and `TreasuryRawRow`/`TreasuryRawRowsJob`
  contract the 7 PDF sources already use — **zero changes to
  `treasury-service`**. It cannot tell a Drive-sourced row from a manually
  uploaded one, by design.
- New UI section inside `/treasury/imports` ("Arquivos no Drive"),
  mirroring `/ingestion`'s existing section, scoped to treasury.

## Non-goals (this pass)

- Nubank, PagBank, Bradesco, PagSeguro fatura via Drive — no real file to
  build and test against yet (see Goals). Adding one later is: confirm its
  real format against a real file (same diligence as this design's own
  groundwork), write one parser, add one signature to the detector, add
  one entry to a source→queue map. No architecture change.
- Reusing the operator's own "Tipo"/"Detalhe" columns (C6's Sheets already
  carry values like "Deslocamento"/"alimentação") as the row's
  classification. **`TreasuryRawRow.structuralHint` is reserved for facts
  the file's own structure fixes independent of counterparty** — see
  `c6-statement.parser.ts`'s `PATTERNS` (e.g. "PGTO FAT CARTAO C6" is
  always "Pagamento de fatura", regardless of payee). "Deslocamento" for
  a specific merchant is the operator's own judgment call, the same kind
  of decision `treasury-service`'s mapping-rule engine already makes from
  counterparty text — reusing it here would create a second, uncoordinated
  source of classification. The engine classifies every row identically
  regardless of source, same as today. Revisiting this (e.g. extending the
  contract with an explicit operator-hint field the mapping engine can
  prefer) is a separate, later decision if it turns out to matter.
- Making the existing `drive-source` module generic across "sources" —
  rejected explicitly (see Context in chat history): its validation
  (coverage-by-day, edge-day tolerance) is sales-specific and doesn't map
  to a whole-month bank statement, and generalizing it risks a feature
  that's already in production every month. This is a new, parallel,
  deliberately simpler module.

## Architecture

New module, parallel to `drive-source/`, not inside it:
`backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/`.

Reused as-is (no changes): `GoogleDriveClient`/`createGoogleDriveClient`
(`drive-source/services/google-drive.client.ts` — `download`/`exportSheet`
already handle native Google Sheets, already proven against this exact
folder during this design's own groundwork), `readWorkbookRows`
(`ingestion/utils/read-workbook-rows.ts`), the credential-parsing half of
`loadDriveConfig` (extract into a small shared helper both configs call —
see "Config" below), `S3Service` (`@app/aws`), `TREASURY_QUEUES`/
`TreasuryRawRow`/`TreasuryRawRowsJob` (`@app/treasury-ingestion-contracts`,
unchanged).

Not reused: `drive_file`'s schema/validation/scan-transition state machine
— genuinely different shape of problem (2-level folder traversal vs. flat;
no coverage validation; no synthetic-data pattern needed, since only
allowlisted month/bank folders are ever scanned in the first place).

```
Google Drive "Extratos" folder
  │  (06:00 cron, own instance — OR "Sincronizar agora")
  ▼
TreasuryDriveScanService
  · lists Extratos/ children, keeps only allowlisted month folders
  · lists each month folder's children, keeps only recognized bank folders
  · lists each bank folder's children (files only — subfolders like
    "comprovantes itau" are skipped, same as drive-source already does)
  · reads each file's content, matches against the 3 known signatures
  · upserts TreasuryDriveFile (new/changed/missing by content hash)
  ▼
/treasury/imports "Arquivos no Drive" section
  · operator reviews: bank, detected type, month, new/changed
  · operator clicks Importar → confirms BankAccount (suggested from the
    bank folder, e.g. "itau" → the Itaú BankAccount, but never assumed)
  ▼
TreasuryDriveImportService
  · re-downloads/re-exports fresh, re-detects the signature (never trusts
    the scan's cached read for the actual write — same "refaz tudo"
    principle drive-source's own import already follows)
  · runs the matching new parser → { rows, rejections }
  · uploads the raw file to S3 (objectKey — same evidence trail every
    other treasury source already has)
  · publishes ONE TreasuryRawRowsJob to treasury.raw-rows
  · marks the TreasuryDriveFile imported
```

## Data model

New table, `TreasuryDriveFile` (this service's own Prisma schema, its own
migration):

```prisma
model TreasuryDriveFile {
  id                Int      @id @default(autoincrement())
  drive_file_id     String   @unique
  month_folder_name String   // "agosto" — display/grouping only, never the write's period
  bank_folder_name  String   // "itau" | "c6"
  detected_source   String?  // TreasurySource value once a signature matches; null = unrecognized
  name              String
  modified_time     DateTime // Drive's own metadata — this IS the import's period source, not the folder name
  content_sha256    String
  status            String   // new | changed | importing | imported | ignored | missing | error
  imported_at       DateTime?
  imported_account_id Int?   // the BankAccount the operator confirmed at import time
  error_detail      String?
  created_at        DateTime @default(now())
  updated_at        DateTime @updatedAt

  @@map("treasury_drive_file")
}
```

No `validation_status`/`validation_report` fields — there is no coverage
concept here to validate; "recognized vs. not" and "duplicate vs. not" are
the only two questions, both answered at scan time and re-checked at
import time.

## Config

New env vars (same `.env`/docker-compose pattern as `drive-source`):

| Variable | Purpose |
|---|---|
| `TREASURY_DRIVE_ROOT_FOLDER_ID` | The "Extratos" folder id. Independent of `GOOGLE_DRIVE_ROOT_FOLDER_ID` — two folders, two configs, same credential. |
| `TREASURY_DRIVE_MONTH_FOLDERS` | Comma-separated allowlist of month folder names to scan, e.g. `agosto,setembro`. Extended by hand each month — deliberately not computed from a start-date, to avoid a year-rollover bug in a financially consequential feature (the folders carry no year). |
| `TREASURY_DRIVE_SCAN_CRON` | Defaults to the same `0 6 * * *` America/Sao_Paulo as sales/abastecimento; its own env var, its own scheduler instance — not shared state with `drive-source`'s. |
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` / `_FILE` | Reused as-is — same service account already has Reader access to this folder (confirmed live). |

`loadTreasuryDriveConfig(source)`: same credential-parsing/validation
shape as `loadDriveConfig`, but far shorter — no thresholds, no
`includePatterns`/`syntheticPattern` (the month-folder allowlist already
does that job). Extract the ~15 lines of credential parsing (base64
decode, `client_email`/`private_key` shape check, file-vs-base64
mutual-exclusion) out of `drive.config.ts` into a small shared function
both configs call, rather than duplicating it — the one piece of this
design that touches an existing file, and only additively (export one more
function, no behavior change to the existing export).

## Format detection

Content-based, matching how `drive-source` already tells abastecimento
from vendas-por-rede from the old per-store format — never by filename
(the real files are named "extrato c6 agosto", "Fatura_2026-09-01",
"Entradas_Saidas_ag2059cc996765_15-09-26": no reliable per-source
filename convention to match against).

For a file inside `.../itau/`: read it via `exportSheet` +
`readWorkbookRows`; match if any of the first ~15 rows contains cells
matching `Agência:`/`Conta:`/`Período:` labels (mirrors
`locateRawHeaderRow`'s "search a window, don't assume a position"
convention) → `detected_source: 'itau_statement'`.

For a file inside `.../c6/`: same read; match by header row signature —
a row containing both `Entrada(R$)` and `Saída(R$)` →
`detected_source: 'c6_statement'`; a row containing both
`Nome no Cartão` and `Valor (em R$)` → `detected_source: 'c6_invoice'`.
(Distinguishing extrato from invoice by header shape, not by which of the
two files in the folder came first or by filename — a folder could
plausibly hold either in either order.)

A file whose content matches none of the above is left
`detected_source: null`, listed as "não reconhecido" in the UI, never
imported, never guessed.

## New parsers

`backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/`:
`itau-statement-sheet.parser.ts`, `c6-statement-sheet.parser.ts`,
`c6-invoice-sheet.parser.ts`. Same signature as every existing treasury
parser (`c6-statement.parser.ts` read in full during this design):

```typescript
function parse(rows: unknown[][]): ParseStatementLinesResult // { rows: TreasuryRawRow[], rejections: TreasuryRawRejection[] }
```

taking the already-read `SheetRows.rows` instead of `PdfPage[]`.
`structuralHint` is populated only where `c6-statement.parser.ts`'s own
`PATTERNS` precedent already fires (fixed, vendor-independent labels like
"PGTO FAT CARTAO C6"), if such a label is present in these sheets at all —
never from "Tipo"/"Detalhe" (see Non-goals).

**Known gap going into implementation**: this design's own real-file
read only reached the Itaú file's header block (Agência/Conta/Período,
"Lançamentos" section start) — the actual transaction row layout
underneath it wasn't inspected far enough to specify its columns here.
Confirming that layout against the real file (same file this design
already downloaded and read) is the first step of implementing
`itau-statement-sheet.parser.ts`, not a placeholder — matches this
codebase's own established practice of reading the real file before
writing a parser (see `ingestion-worker-service/CLAUDE.md`'s "Por que
colunas desconhecidas falham o arquivo"). The C6 extrato/invoice column
layouts are already fully specified above — both header rows were read
in full.

The `Fatura_2026-09-01`'s "Parcela" column showed one row with a
serialized date value (`2026-06-05T00:00:00.000Z`) where every other row
had plain text (`"Única"`) — almost certainly Excel auto-formatting a
value that looked like a date (e.g. a "05/06" installment notation).
The invoice parser must handle both shapes defensively — coerce a
date-typed cell back to its likely original text, never crash or silently
drop the row.

## Import flow, account confirmation

`TreasuryRawRowsJob.accountId` is required and "never guessed from the
file" (contract's own doc comment). At "Importar" time the operator sees
the bank folder name (e.g. "itau") pre-selecting the matching
`BankAccount` from a dropdown of the treasury-service's real accounts —
never auto-submitted without that confirmation, same principle as every
other human-confirms-before-write point in this codebase.

`period` (YYYY-MM) is suggested from the file's own `modifiedTime` (real
Drive metadata), not parsed from the month folder's name — sidesteps the
folder name's year ambiguity entirely. The operator confirms this too,
editable, same as sales/abastecimento's own Drive-import confirmation
step already works.

## UI

`/treasury/imports` gains a new "Arquivos no Drive" section, positioned
above the existing manual-upload history table, visually matching
`/ingestion`'s existing Drive section component-for-component (reuse
what's reusable from `drive-files-section.tsx`/`drive-file-row.tsx`'s
presentational shell; the underlying data/actions are treasury-scoped,
against new endpoints — see Routes). "Sincronizar agora" button triggers
`POST /treasury-drive-files/scan` the same way `/ingestion`'s button
triggers `POST /drive-files/scan` today.

## Routes

New controller, `treasury-drive-files.controller.ts` (worker), mirrored by
gateway (`gateway-service/.../treasury-drive-files.controller.ts`), same
shape as the existing `drive-files.controller.ts`:

| Route | Purpose |
|---|---|
| `GET /treasury-drive-files` | List tracked files + status |
| `GET /treasury-drive-files/status` | `{configured, enabled}` — dormant until the two new env vars are set |
| `POST /treasury-drive-files/scan` | Manual "Sincronizar agora" (202) |
| `POST /treasury-drive-files/:id/import` | `{accountId, period}` confirmed by the operator (202) |
| `POST /treasury-drive-files/:id/ignore` | Same escape hatch the sales/abastecimento flow already has |

## Error handling

- **Unreadable/unrecognized file**: `detected_source: null`, status stays
  `new`, listed as unrecognized, never imported.
- **Duplicate**: same `content_sha256` already `imported` for that
  `bank_folder_name` → blocked with a clear reason, mirrors
  `would_replace`'s spirit without needing its full machinery (no
  multi-period fingerprint tracking needed here — one file per bank per
  month is the whole shape).
- **Drive/service-account error** (folder not shared, credential invalid):
  surfaces the same way `loadDriveConfig`'s own startup validation does —
  names the problem, never partially enables.
- **Parser rejects rows**: same as every existing treasury parser —
  `rejections: TreasuryRawRejection[]` in the job, surfaced to the
  operator by `treasury-service` exactly like a manually uploaded file's
  rejections already are. No new UI needed for this part.

## Testing

- Unit: the 3 new parsers, against fixtures cut from the real files —
  re-export them fresh from Drive at implementation time
  (`Extratos/agosto/itau/Entradas_Saidas_ag2059cc996765_15-09-26`,
  `Extratos/agosto/c6/extrato c6 agosto`,
  `Extratos/agosto/c6/Fatura_2026-09-01` — same 3 files this design's own
  groundwork already read; the service account already has access) — same
  "cut from the real export" precedent every other treasury parser's test
  fixture already follows (`ingestion-worker-service/CLAUDE.md`: "Bradesco,
  Nubank e a fatura PagSeguro bateram a soma EXATA contra o total que o
  próprio arquivo declara"); the "Parcela" date-vs-text quirk gets its own
  case. Format-signature detection: each of the 3 real headers matches its
  own type and no other; a fourth, unrelated sheet matches none.
- Integration: scan (allowlisted-folder filtering, subfolder-as-noise
  skipping, new/changed/duplicate detection) against the disposable
  Postgres pattern `drive-source` already uses, with an in-memory Drive
  client fixture (mirroring `InMemoryDriveClient`) rather than the real
  Google API.
- No plan step talks to the real Google Drive except the one-time
  acceptance the operator does herself against the real "Extratos" folder,
  same precedent as `add-drive-ingestion-source`'s own task 13.3.

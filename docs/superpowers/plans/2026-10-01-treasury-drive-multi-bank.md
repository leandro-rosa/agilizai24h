# Treasury Drive multi-bank coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the treasury Drive sync (Itaú/C6 only, shipped 2026-09-30) to also recognize and import Nubank and PagBank, and to read real uploaded `.xlsx`/PDF files — not just native Google Sheets — reusing the 5 existing PDF parsers instead of writing new ones.

**Architecture:** A single shared "read and classify" step replaces the current native-Sheet-only branch in both the scan and import services: it downloads any non-native-Sheet file's raw bytes (a capability `DriveClient.download` already has), sniffs the real magic bytes (a Drive-reported `mimeType` of `application/pdf` can lie — a real file found in the actual folder is a zip/xlsx mislabeled that way), and routes to either the existing xlsx reader or PDF text extraction (with a configured password retry) before either of the two content-detection functions ever runs.

**Tech Stack:** NestJS, ExcelJS (via `readWorkbookRows`), `pdf-parse` (via `extractPdfPages`), Jest.

**Spec:** [docs/superpowers/specs/2026-10-01-treasury-drive-multi-bank-design.md](../specs/2026-10-01-treasury-drive-multi-bank-design.md)

## Global Constraints

- Bradesco stays out of scope — no real file this month to verify detection/parsing against.
- No UI changes — `detected_source` already renders generically for any `TreasurySource`; the frontend already has labels and account hints for `pagbank_statement`.
- No change to the `treasury.raw-rows` contract or to `treasury-service` — every parser this plan touches already produces the exact same `TreasuryRawRow`/`TreasuryRawRejection` shape the existing 7 sources use.
- `structuralHint` is never derived from the operator's own manual classification columns (C6 sheets' `Tipo`/`Detalhe`) — only from bank-printed, file-structural signals, reusing the existing PDF parsers' own pattern lists rather than re-typing them.
- A file whose content cannot be read (wrong/missing PDF password, corrupt bytes, genuinely unrecognized format) is recorded as unrecognized and the scan/import must never crash or abort processing the rest of the tree because of it.

## Review Focus

- **A PDF that Drive reports as `application/pdf` but whose real bytes are a mislabeled zip/xlsx** (observed for real in the "pagseguro" folder) — must be read as a spreadsheet by its real content, never rejected just because the claimed mimeType says PDF. Task 6's reader-utility tests cover this with the exact real byte signature observed.
- **A PDF that genuinely requires a password, with no password configured** — must be recorded as unrecognized (never crash the scan, never silently retry forever). Task 1's `extractPdfPages` tests and Task 6's reader-utility tests both cover this.
- **The same bank/source arriving in two different formats across different months** (C6 invoice: a native Sheet in August, a password-protected PDF in September, confirmed for real) — both must resolve to the same `c6_invoice` detection and produce rows through the parser matching whichever format was actually read. Task 8's import-routing tests cover both paths for the same source.
- **A bank folder recognized by name but whose real file content matches no known signature** — must be listed as unrecognized, never guessed as the "closest" bank just because the folder name suggested one. Task 3/4's detection tests cover a folder with unrecognized content.
- **`isRecognizedBankFolder` gaining two new names must not silently also start recognizing Bradesco** — the allowlist is explicit, not inferred from `TREASURY_SOURCES`' 7 literal values; Task 2's test asserts Bradesco is still excluded after this change.

---

## Task 1: PDF password support in `extractPdfPages`

**Files:**
- Modify: `backend/apps/ingestion-worker-service/src/modules/treasury-ingestion/utils/pdf-text.ts`
- Test: `backend/apps/ingestion-worker-service/src/modules/treasury-ingestion/utils/pdf-text.spec.ts` (new — this utility has no existing spec file; confirm by listing the directory before creating)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PdfPasswordRequiredError` (exported class), `extractPdfPages(buffer: Buffer, password?: string): Promise<PdfPage[]>` (same name, now takes an optional second argument — existing call sites that pass only a buffer are unaffected), consumed by Task 6's shared reader utility.

- [ ] **Step 1: Confirm there's no existing spec file for this utility, and read the real current file in full**

Run: `ls backend/apps/ingestion-worker-service/src/modules/treasury-ingestion/utils/pdf-text*`
Read `pdf-text.ts` in full (already quoted below from earlier research, but re-read for any drift before editing) to get the current `extractPdfPages` body exactly.

- [ ] **Step 2: Add `pdf-lib` as a devDependency, write a real encrypted PDF fixture, and write the failing tests**

Confirmed: `package.json` has `pdf-parse` (reads PDFs) but nothing that writes/encrypts one — `pdf-lib` is the standard, pure-JS, no-native-bindings choice for that, and it's needed only to generate a committed test fixture once, never at runtime. Add it as a devDependency:

```bash
cd backend/apps/ingestion-worker-service
pnpm add -D pdf-lib
```

Generate the fixture (run once; the output is what gets committed, not this script):

```bash
mkdir -p src/modules/treasury-ingestion/utils/test/fixtures
node -e "
const { PDFDocument } = require('pdf-lib');
(async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 100]);
  page.drawText('AGILIZ.AI LTDA fatura teste', { x: 10, y: 50 });
  await doc.encrypt({ userPassword: 'test1234', ownerPassword: 'test1234' });
  const bytes = await doc.save();
  require('fs').writeFileSync('src/modules/treasury-ingestion/utils/test/fixtures/encrypted-sample.pdf', Buffer.from(bytes));
  console.log('written', bytes.length, 'bytes');
})();
"
```

Confirm it is genuinely encrypted before using it as a fixture:

```bash
node -e "
const { PDFParse } = require('pdf-parse');
(async () => {
  const fs = require('fs');
  const buffer = fs.readFileSync('src/modules/treasury-ingestion/utils/test/fixtures/encrypted-sample.pdf');
  try {
    await new PDFParse({ data: buffer }).getText();
    console.log('FAIL: read without a password — not actually encrypted');
  } catch (e) {
    console.log('confirmed password-required:', e.message);
  }
  const result = await new PDFParse({ data: buffer, password: 'test1234' }).getText();
  console.log('confirmed readable with the right password:', result.pages[0].text.trim());
})();
"
```

Both lines must print as expected (a thrown password error with no password; the real text with `test1234`) before committing the fixture — if the first line prints "FAIL", the `encrypt()` call above didn't take effect and the fixture must be regenerated.

Write the failing tests:

```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractPdfPages, PdfPasswordRequiredError } from './pdf-text'

const ENCRYPTED_FIXTURE = join(__dirname, 'test/fixtures/encrypted-sample.pdf')

describe('extractPdfPages', () => {
  it('throws PdfPasswordRequiredError when a password-protected PDF is read with no password', async () => {
    const buffer = readFileSync(ENCRYPTED_FIXTURE)
    await expect(extractPdfPages(buffer)).rejects.toBeInstanceOf(PdfPasswordRequiredError)
  })

  it('reads a password-protected PDF correctly when the right password is given', async () => {
    const buffer = readFileSync(ENCRYPTED_FIXTURE)
    const pages = await extractPdfPages(buffer, 'test1234')
    expect(pages.length).toBeGreaterThan(0)
    expect(pages[0].lines.join(' ')).toContain('AGILIZ.AI LTDA fatura teste')
  })

  it('throws a normal error (not PdfPasswordRequiredError) when the password is wrong', async () => {
    const buffer = readFileSync(ENCRYPTED_FIXTURE)
    await expect(extractPdfPages(buffer, 'wrong-password')).rejects.not.toBeInstanceOf(PdfPasswordRequiredError)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && NODE_OPTIONS=--experimental-vm-modules pnpm test -- pdf-text.spec.ts`
Expected: FAIL — `PdfPasswordRequiredError` is not exported, `extractPdfPages` doesn't take a second argument yet.

- [ ] **Step 4: Implement**

```typescript
import { PDFParse } from 'pdf-parse'

export interface PdfPage {
  pageNumber: number
  lines: string[]
}

/** Thrown when a PDF cannot be read because it requires a password that wasn't given. */
export class PdfPasswordRequiredError extends Error {
  constructor() {
    super('This PDF requires a password to read')
    this.name = 'PdfPasswordRequiredError'
  }
}

function isPasswordRequiredError(error: unknown): boolean {
  return error instanceof Error && /password/i.test(error.message)
}

/**
 * Extracts text per page, split into lines. The treasury PDF sources are bank-generated, not
 * scanned — they carry a real text layer, so this is text-layer extraction, never OCR.
 *
 * `password` is only ever supplied by the Drive-sourced import path (a real C6 invoice PDF found
 * in the "Extratos" folder is password-protected — confirmed against the real file during design;
 * the manually-uploaded PDF path never passes one, since an operator uploading by hand already has
 * the file open and readable before choosing to upload it).
 */
export async function extractPdfPages(buffer: Buffer, password?: string): Promise<PdfPage[]> {
  const parser = new PDFParse({ data: buffer, password })
  try {
    const result = await parser.getText()
    return result.pages.map(page => ({
      pageNumber: page.num,
      lines: page.text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0),
    }))
  } catch (error) {
    if (password === undefined && isPasswordRequiredError(error)) throw new PdfPasswordRequiredError()
    throw error
  } finally {
    await parser.destroy()
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && NODE_OPTIONS=--experimental-vm-modules pnpm test -- pdf-text.spec.ts`
Expected: PASS, 3/3.

- [ ] **Step 6: Run the whole service's test suite to confirm the signature change didn't break an existing call site**

Run: `cd backend/apps/ingestion-worker-service && NODE_OPTIONS=--experimental-vm-modules pnpm test`
Expected: PASS, same count as before plus 3.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/ingestion-worker-service/package.json pnpm-lock.yaml backend/apps/ingestion-worker-service/src/modules/treasury-ingestion/utils/pdf-text.ts backend/apps/ingestion-worker-service/src/modules/treasury-ingestion/utils/pdf-text.spec.ts backend/apps/ingestion-worker-service/src/modules/treasury-ingestion/utils/test/fixtures/encrypted-sample.pdf
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): optional password support in extractPdfPages

A real C6 invoice PDF found in the treasury Drive folder is password-
protected (confirmed against the real file). Existing callers that pass
only a buffer are unaffected.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Config — PDF password, and the two new bank folders

**Files:**
- Modify: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/config/treasury-drive.config.ts`
- Modify: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/config/treasury-drive.config.spec.ts`
- Modify: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/month-folder-allowlist.ts`
- Modify: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/month-folder-allowlist.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TreasuryDriveConfig.pdfPassword?: string`, `isRecognizedBankFolder` now also returns `true` for `'nubank'`/`'pagseguro'` — consumed by Task 6 (config) and Tasks 3/7/8 (allowlist).

- [ ] **Step 1: Write the failing config test**

Read the current `treasury-drive.config.ts`/`.spec.ts` in full first (already quoted above from this plan's own research). Add this test inside the existing `describe('loadTreasuryDriveConfig', ...)` block, so it reuses that block's own `validCredential` constant:

```typescript
it('reads an optional PDF password, undefined when unset', () => {
  const withPassword = loadTreasuryDriveConfig({
    TREASURY_DRIVE_ROOT_FOLDER_ID: 'folder-1',
    GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: validCredential,
    TREASURY_DRIVE_PDF_PASSWORD: '608193',
  })
  expect(withPassword.pdfPassword).toBe('608193')

  const withoutPassword = loadTreasuryDriveConfig({
    TREASURY_DRIVE_ROOT_FOLDER_ID: 'folder-1',
    GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: validCredential,
  })
  expect(withoutPassword.pdfPassword).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- treasury-drive.config.spec.ts`
Expected: FAIL — `pdfPassword` is not a recognized property / always undefined.

- [ ] **Step 3: Implement**

Add `pdfPassword?: string` to the `TreasuryDriveConfig` interface, and in `loadTreasuryDriveConfig`:

```typescript
pdfPassword: text(source, 'TREASURY_DRIVE_PDF_PASSWORD'),
```

(reusing the existing `text()` helper already in this file, which returns `undefined` for an unset/empty value).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- treasury-drive.config.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing allowlist tests**

```typescript
describe('isRecognizedBankFolder — multi-bank', () => {
  it('recognizes nubank and pagseguro, case-insensitively', () => {
    expect(isRecognizedBankFolder('nubank')).toBe(true)
    expect(isRecognizedBankFolder('PagSeguro')).toBe(true)
  })

  it('still does not recognize bradesco — no real file to verify against yet', () => {
    expect(isRecognizedBankFolder('bradesco')).toBe(false)
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- month-folder-allowlist.spec.ts`
Expected: FAIL — `nubank`/`pagseguro` not yet in the allowlist.

- [ ] **Step 7: Implement**

```typescript
const RECOGNIZED_BANK_FOLDERS = ['itau', 'c6', 'nubank', 'pagseguro']
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- month-folder-allowlist.spec.ts`
Expected: PASS, all green including the 2 new ones.

- [ ] **Step 9: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/config/ backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/month-folder-allowlist.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/month-folder-allowlist.spec.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): treasury Drive config/allowlist for Nubank and PagBank

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Sheet detection — PagBank statement signature

**Files:**
- Modify: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/detect-source.ts`
- Modify: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/detect-source.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `detectTreasurySheetSource` now also returns `'pagbank_statement'` for real PagBank content — consumed by Task 6/8.

- [ ] **Step 1: Write the failing test using the real captured header/content**

The real "pagseguro" folder file, once read as a spreadsheet, has this real structure (captured during design research — a merged-cell artifact repeats the same value across several columns, exactly as ExcelJS returns it for a real merged cell; don't simplify this away in the fixture, it's real):

```typescript
it('detects a PagBank statement by its header row and bank name in the metadata block', () => {
  const rows = [
    [null, { richText: [{ text: 'Nome do Titular : AGILIZ.AI LTDA' }] }],
    [null, { richText: [{ text: 'Banco : 290 - PagSeguro Internet S/A' }] }],
    [null, { richText: [{ text: 'Agência : 0001' }] }],
    [null, { richText: [{ text: 'Conta 76803075-1' }] }],
    [null, { richText: [{ text: 'Período : 01/09/2026 a 30/09/2026' }] }],
    [],
    [],
    [],
    [null, { richText: [{ text: 'Data' }] }, { richText: [{ text: 'Tipo' }] }, { richText: [{ text: 'Descrição' }] }, { richText: [{ text: 'Entradas' }] }, { richText: [{ text: 'Saidas' }] }, { richText: [{ text: 'Saldo' }] }],
  ]
  expect(detectTreasurySheetSource(sheet(rows), 'pagseguro')).toBe('pagbank_statement')
})

it('does not detect pagbank_statement for an unrelated sheet in the pagseguro folder', () => {
  const rows = [['Something', 'Unrelated', 'Header']]
  expect(detectTreasurySheetSource(sheet(rows), 'pagseguro')).toBeNull()
})
```

(`sheet()` is the existing test helper already in this spec file — confirm its exact shape by reading the file before adding these, it wraps `rows` into `SheetRows[]`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- detect-source.spec.ts`
Expected: FAIL — `detectTreasurySheetSource` returns `null` for the pagseguro folder (no branch handles it yet).

- [ ] **Step 3: Implement**

`rowHasAll` already does `cells.some(cell => cell.includes(label))` on `String(cell ?? '')` — a rich-text object stringifies to `"[object Object]"`, which would never match. Add a small cell-to-text helper (mirroring the one already duplicated in the sheet parsers) so detection, not just parsing, survives a merged rich-text cell:

```typescript
function cellText(cell: unknown): string {
  if (cell && typeof cell === 'object' && 'richText' in cell) {
    return (cell as { richText: { text: string }[] }).richText.map(part => part.text).join('')
  }
  if (cell && typeof cell === 'object' && 'text' in cell) return String((cell as { text: unknown }).text ?? '')
  return String(cell ?? '')
}

function rowHasAll(row: unknown[], labels: string[]): boolean {
  const cells = row.map(cell => cellText(cell).trim())
  return labels.every(label => cells.some(cell => cell.includes(label)))
}
```

(This replaces the existing `rowHasAll` body — same signature, same callers, now resilient to a rich-text cell. Re-run the Itaú/C6 tests too after this change, since they share this helper — they use plain strings, so `cellText` passes them through unchanged via the final `String(cell ?? '')` fallback.)

```typescript
function matchesPagBankStatement(rows: unknown[][]): boolean {
  return rows.slice(0, SEARCH_WINDOW).some(row => rowHasAll(row, ['PagSeguro Internet S/A']))
    && rows.slice(0, SEARCH_WINDOW).some(row => rowHasAll(row, ['Entradas', 'Saidas']))
}
```

Add the branch inside `detectTreasurySheetSource`:

```typescript
if (bank === 'pagseguro' && matchesPagBankStatement(sheet.rows)) return 'pagbank_statement'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- detect-source.spec.ts`
Expected: PASS, all green including the 2 new ones and the pre-existing Itaú/C6 ones (unaffected by the `cellText` change).

- [ ] **Step 5: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/detect-source.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/detect-source.spec.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): detect PagBank statement sheets, survive merged rich-text cells

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: PDF content detection — Nubank and C6 invoice

**Files:**
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/detect-pdf-source.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/detect-pdf-source.spec.ts`

**Interfaces:**
- Consumes: `PdfPage` (`../../treasury-ingestion/utils/pdf-text`).
- Produces: `detectTreasuryPdfSource(pages: PdfPage[], bankFolderName: string): TreasurySource | null`, consumed by Task 6/8.

- [ ] **Step 1: Write the failing tests using the real captured PDF text**

The real Nubank PDF's first page (captured during design research) contains, among other lines:
```
AGILIZ.AI LTDA
60.819.321/0001-44 0001	CNPJ Agência Conta
a	01 DE SETEMBRO DE 2026 30 DE SETEMBRO DE 2026 VALORES EM R$
Movimentações
```

The real C6 invoice PDF's first page (captured during design research, after decryption) contains:
```
Olá, AGILIZ.AI LTDA! Sua fatura com
vencimento em Outubro chegou
no valor de R$ 16.623,15.
```

```typescript
import { detectTreasuryPdfSource } from './detect-pdf-source'
import type { PdfPage } from '../../treasury-ingestion/utils/pdf-text'

function pages(lines: string[]): PdfPage[] {
  return [{ pageNumber: 1, lines }]
}

describe('detectTreasuryPdfSource', () => {
  it('detects a Nubank statement by its real header text, in the nubank folder', () => {
    const lines = ['AGILIZ.AI LTDA', '60.819.321/0001-44 0001\tCNPJ Agência Conta', 'Movimentações']
    expect(detectTreasuryPdfSource(pages(lines), 'nubank')).toBe('nubank_statement')
  })

  it('detects a C6 invoice by its real greeting text, in the c6 folder', () => {
    const lines = ['Olá, AGILIZ.AI LTDA! Sua fatura com', 'vencimento em Outubro chegou', 'no valor de R$ 16.623,15.']
    expect(detectTreasuryPdfSource(pages(lines), 'c6')).toBe('c6_invoice')
  })

  it('returns null for PDF content matching no known signature', () => {
    expect(detectTreasuryPdfSource(pages(['Something unrelated']), 'nubank')).toBeNull()
  })

  it('returns null when the bank folder is not one this function recognizes for PDF content', () => {
    const lines = ['Olá, AGILIZ.AI LTDA! Sua fatura com', 'vencimento em Outubro chegou']
    expect(detectTreasuryPdfSource(pages(lines), 'pagseguro')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- detect-pdf-source.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
import type { PdfPage } from '../../treasury-ingestion/utils/pdf-text'
import type { TreasurySource } from '@app/treasury-ingestion-contracts'

function fullText(pages: PdfPage[]): string {
  return pages.map(page => page.lines.join(' ')).join(' ')
}

function matchesNubankStatement(text: string): boolean {
  return text.includes('CNPJ') && text.includes('Agência') && text.includes('Movimentações')
}

function matchesC6Invoice(text: string): boolean {
  return text.includes('Sua fatura com') || text.includes('vencimento')
}

/**
 * Content-based detection for PDF-sourced treasury files — the sibling of
 * `detectTreasurySheetSource` for sheet content. Only 2 sources are ever reached through this
 * path today: `nubank_statement` and `c6_invoice` (confirmed by real files in the "Extratos"
 * folder — PagBank's real file is a mislabeled sheet, not a real PDF; see
 * `detectTreasurySheetSource`'s own `pagbank_statement` branch instead). The bank folder still
 * narrows which signature to check, exactly like the sheet version — but never decides the
 * source by itself.
 */
export function detectTreasuryPdfSource(pages: PdfPage[], bankFolderName: string): TreasurySource | null {
  const bank = bankFolderName.trim().toLowerCase()
  const text = fullText(pages)

  if (bank === 'nubank' && matchesNubankStatement(text)) return 'nubank_statement'
  if (bank === 'c6' && matchesC6Invoice(text)) return 'c6_invoice'

  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- detect-pdf-source.spec.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/detect-pdf-source.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/detect-pdf-source.spec.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): content-based detection for PDF-sourced treasury files

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `pagbank-statement-sheet.parser.ts`

**Files:**
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/pagbank-statement-sheet.parser.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/pagbank-statement-sheet.parser.spec.ts`

**Interfaces:**
- Consumes: `TreasuryRawRow`, `TreasuryRawRejection` (`@app/treasury-ingestion-contracts`).
- Produces: `parsePagBankStatementSheet(rows: unknown[][]): { rows: TreasuryRawRow[]; rejections: TreasuryRawRejection[] }`, consumed by Task 8.

The real header (captured during design research, row 9 of the real file, 0-indexed row 8): `Data, Tipo, Descrição, Entradas, Saidas, Saldo` — each cell a merged rich-text object repeated across 2 columns (the real file's own merge artifact; the parser must read past that, same as detection in Task 3). Real sample data rows (captured during design research):

```
["01/09/2026", "01/09/2026", "Vendas", "Vendas", "Disponivel PIX", 5.86]
["01/09/2026", "01/09/2026", "Vendas", "Vendas", "Disponivel PIX", 6.85]
```

Column positions in the real row: `Data` at 1, `Tipo` at 3 (duplicated at 2/3 by the merge), `Descrição` at 4, then `Entradas` OR `Saidas` depending on which is populated (the real sample rows above only ever show one numeric value — confirm during implementation whether that's "Entradas populated, Saidas blank" or a single shared value column; re-read the detect-source test fixture's real header row position indices from Task 3 to confirm the exact column layout before finalizing, since the header itself was captured with the same merge pattern).

- [ ] **Step 1: Write the failing tests**

```typescript
import { parsePagBankStatementSheet } from './pagbank-statement-sheet.parser'

function cell(text: string) {
  return { richText: [{ text }] }
}

const HEADER = [null, cell('Data'), cell('Tipo'), cell('Descrição'), cell('Entradas'), cell('Saidas'), cell('Saldo')]

describe('parsePagBankStatementSheet', () => {
  it('parses a real inflow row (Entradas populated)', () => {
    const rows = [HEADER, [null, '01/09/2026', 'Vendas', 'Disponivel PIX', 5.86, null, null]]
    const result = parsePagBankStatementSheet(rows)
    expect(result.rejections).toEqual([])
    expect(result.rows[0]).toEqual({
      occurredOn: '2026-09-01',
      amountCents: 586,
      direction: 'inflow',
      counterpartyRaw: 'Disponivel PIX',
      sourceRef: 'row2',
    })
  })

  it('parses an outflow row (Saidas populated)', () => {
    const rows = [HEADER, [null, '02/09/2026', 'Compra', 'Pagamento fornecedor', null, 120.5, null]]
    const result = parsePagBankStatementSheet(rows)
    expect(result.rows[0].direction).toBe('outflow')
    expect(result.rows[0].amountCents).toBe(12050)
  })

  it('rejects a row with neither Entradas nor Saidas populated', () => {
    const rows = [HEADER, [null, '02/09/2026', 'Tipo', 'Descrição', null, null, 100]]
    const result = parsePagBankStatementSheet(rows)
    expect(result.rows).toEqual([])
    expect(result.rejections).toHaveLength(1)
    expect(result.rejections[0].reason).toBe('no_amount')
  })

  it('rejects a row with an unparseable date rather than dropping it', () => {
    const rows = [HEADER, [null, 'not-a-date', 'Vendas', 'Disponivel PIX', 5.86, null, null]]
    const result = parsePagBankStatementSheet(rows)
    expect(result.rows).toEqual([])
    expect(result.rejections[0].reason).toBe('unparseable_date')
  })

  it('never sets structuralHint — no equivalent PATTERNS list exists for PagBank sheets, and Tipo is the operator-adjacent column here too', () => {
    const rows = [HEADER, [null, '01/09/2026', 'Vendas', 'Disponivel PIX', 5.86, null, null]]
    const result = parsePagBankStatementSheet(rows)
    expect(result.rows[0].structuralHint).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- pagbank-statement-sheet.parser.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Mirror `c6-statement-sheet.parser.ts` (Entradas/Saidas direction logic) exactly, with the real PagBank header names and a `cellText` helper identical to Task 3's detection one (local to this file, same duplication convention as every other parser in this module):

```typescript
import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'

const HEADERS = ['Data', 'Tipo', 'Descrição', 'Entradas', 'Saidas', 'Saldo']

function cellText(value: unknown): string {
  if (value && typeof value === 'object' && 'richText' in value) {
    return (value as { richText: { text: string }[] }).richText.map(part => part.text).join('')
  }
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text ?? '')
  return String(value ?? '').trim()
}

function toColumnIndex(header: unknown[]): Record<string, number> {
  const index: Record<string, number> = {}
  header.forEach((cell, i) => {
    const key = cellText(cell).trim()
    if (key && index[key] === undefined) index[key] = i
  })
  return index
}

function toDateOnly(value: unknown): string | null {
  const text = cellText(value)
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return null
  const [, day, month, year] = match
  return `${year}-${month}-${day}`
}

function toAmountCents(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(cellText(value))
  if (!Number.isFinite(n) || cellText(value) === '') return null
  return Math.round(n * 100)
}

export function parsePagBankStatementSheet(rows: unknown[][]): { rows: TreasuryRawRow[]; rejections: TreasuryRawRejection[] } {
  const [header, ...dataRows] = rows
  const columnIndex = toColumnIndex(header ?? HEADERS)
  const result: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []

  dataRows.forEach((row, i) => {
    const rowReference = `row${i + 2}`
    const occurredOn = toDateOnly(row[columnIndex['Data']])
    if (!occurredOn) {
      rejections.push({ rowReference, reason: 'unparseable_date', detail: `"Data" is not a recognisable date: ${JSON.stringify(row[columnIndex['Data']])}` })
      return
    }

    const entradas = toAmountCents(row[columnIndex['Entradas']]) ?? 0
    const saidas = toAmountCents(row[columnIndex['Saidas']]) ?? 0

    if (entradas === 0 && saidas === 0) {
      rejections.push({ rowReference, reason: 'no_amount', detail: 'Neither Entradas nor Saidas is populated' })
      return
    }

    result.push({
      occurredOn,
      amountCents: entradas > 0 ? entradas : saidas,
      direction: entradas > 0 ? 'inflow' : 'outflow',
      counterpartyRaw: cellText(row[columnIndex['Descrição']]),
      sourceRef: rowReference,
    })
  })

  return { rows: result, rejections }
}
```

Before finalizing, confirm the real column index positions against the actual captured header row from Task 3's detection fixture (the merge pattern there used two cells per label starting at index 1) — if the real merge means `Descrição` is NOT at the position this reference code assumes, adjust `toColumnIndex`'s lookup accordingly; the by-name lookup already protects against a shifted position as long as every real label text appears somewhere in the header row.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- pagbank-statement-sheet.parser.spec.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/pagbank-statement-sheet.parser.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/pagbank-statement-sheet.parser.spec.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): PagBank statement sheet parser for treasury Drive sync

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Shared "read and classify" Drive file utility

**Files:**
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/read-treasury-drive-file.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/read-treasury-drive-file.spec.ts`

**Interfaces:**
- Consumes: `DriveClient` (`../../drive-source/services/drive-client`), `GOOGLE_SHEET_MIME` (`../../drive-source/constants/drive.constants`), `readWorkbookRows`/`SheetRows` (`../../ingestion/utils/read-workbook-rows`), `extractPdfPages`/`PdfPasswordRequiredError`/`PdfPage` (Task 1), `detectTreasurySheetSource` (existing), `detectTreasuryPdfSource` (Task 4).
- Produces: `readAndClassifyTreasuryDriveFile(client: DriveClient, fileId: string, mimeType: string, bankFolderName: string, destPath: string, maxBytes: number, pdfPassword: string | undefined): Promise<ReadAndClassifyResult>` where `ReadAndClassifyResult = { detectedSource: TreasurySource | null; contentSha256: string; sheets?: SheetRows[]; pages?: PdfPage[] }`, consumed by Task 7 (scan, which has a full `DriveItem` and passes `fileItem.id`/`fileItem.mimeType`) and Task 8 (import, which only has the file's own persisted `drive_file_id`/`mime_type` columns — confirmed via `TreasuryDriveRepository`/schema research that no Drive API call exists to refetch a single file's metadata by id, which is why this function takes the two scalars rather than a full `DriveItem`).

- [ ] **Step 1: Write the failing tests**

```typescript
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { InMemoryDriveClient } from '../../drive-source/testing/in-memory-drive.client'
import { xlsxBuffer } from '../../drive-source/testing/workbook-fixtures'
import type { SheetRows } from '../../ingestion/utils/read-workbook-rows'
import { readAndClassifyTreasuryDriveFile } from './read-treasury-drive-file'

const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ENCRYPTED_PDF_FIXTURE = join(
  __dirname,
  '../../treasury-ingestion/utils/test/fixtures/encrypted-sample.pdf',
)

const PAGBANK_SHEET: SheetRows = {
  sheetName: 'Sheet1',
  rows: [
    ['Nome do Titular : AGILIZ.AI LTDA'],
    ['Banco : 290 - PagSeguro Internet S/A'],
    [],
    ['Data', 'Tipo', 'Descrição', 'Entradas', 'Saidas', 'Saldo'],
    ['01/09/2026', 'Vendas', 'Disponivel PIX', 5.86, null, null],
  ],
}

const C6_STATEMENT_SHEET: SheetRows = {
  sheetName: 'Sheet1',
  rows: [
    ['Data Lançamento', 'Data Contábil', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)', 'Tipo', 'Detalhe'],
    ['2026-08-03', '2026-08-03', 'Pix', 'Pix recebido', 445.93, 0, '', ''],
  ],
}

const UNENCRYPTED_NUBANK_LIKE_PDF = join(__dirname, 'test-fixtures-scratch-unencrypted.pdf')

describe('readAndClassifyTreasuryDriveFile', () => {
  it('reads a native Google Sheet via export, exactly as before', async () => {
    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'extrato', xlsxBuffer([C6_STATEMENT_SHEET]), true)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, GOOGLE_SHEET_MIME, 'c6', '/tmp/test-dest-1', 25 * 1024 * 1024, undefined)
    expect(result.detectedSource).toBe('c6_statement')
    expect(result.sheets).toBeDefined()
  })

  it('reads a real uploaded .xlsx file (not a native Sheet) by downloading and parsing the raw bytes', async () => {
    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'extrato.xlsx', xlsxBuffer([C6_STATEMENT_SHEET]), false)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, XLSX_MIME, 'c6', '/tmp/test-dest-2', 25 * 1024 * 1024, undefined)
    expect(result.detectedSource).toBe('c6_statement')
  })

  it('reads a file Drive reports as application/pdf whose real bytes are a zip/xlsx (the real PagSeguro case)', async () => {
    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'fake.pdf', xlsxBuffer([PAGBANK_SHEET]), false)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, 'application/pdf', 'pagseguro', '/tmp/test-dest-3', 25 * 1024 * 1024, undefined)
    expect(result.detectedSource).toBe('pagbank_statement')
  })

  it('reads a genuine unencrypted PDF with real Nubank-matching text and returns pages', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    const page = doc.addPage([400, 120])
    page.drawText('AGILIZ.AI LTDA', { x: 10, y: 90 })
    page.drawText('60.819.321/0001-44 0001  CNPJ Agência Conta', { x: 10, y: 60 })
    page.drawText('Movimentações', { x: 10, y: 30 })
    writeFileSync(UNENCRYPTED_NUBANK_LIKE_PDF, Buffer.from(await doc.save()))

    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'extrato.pdf', readFileSync(UNENCRYPTED_NUBANK_LIKE_PDF), false)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, 'application/pdf', 'nubank', '/tmp/test-dest-4', 25 * 1024 * 1024, undefined)
    expect(result.pages).toBeDefined()
  })

  it('retries with the configured password when a PDF is password-protected, and succeeds', async () => {
    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'fatura.pdf', readFileSync(ENCRYPTED_PDF_FIXTURE), false)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, 'application/pdf', 'c6', '/tmp/test-dest-5', 25 * 1024 * 1024, 'test1234')
    expect(result.pages?.[0]?.lines.join(' ')).toContain('AGILIZ.AI LTDA fatura teste')
  })

  it('records a password-protected PDF as unrecognized when no password is configured, without throwing', async () => {
    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'fatura.pdf', readFileSync(ENCRYPTED_PDF_FIXTURE), false)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, 'application/pdf', 'c6', '/tmp/test-dest-6', 25 * 1024 * 1024, undefined)
    expect(result.detectedSource).toBeNull()
    expect(result.contentSha256).toBeTruthy()
  })

  it('records content matching neither zip nor PDF magic bytes as unrecognized, without throwing', async () => {
    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'random.bin', Buffer.from([0x00, 0x01, 0x02, 0x03]), false)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, 'application/octet-stream', 'itau', '/tmp/test-dest-7', 25 * 1024 * 1024, undefined)
    expect(result.detectedSource).toBeNull()
    expect(result.contentSha256).toBeTruthy()
  })
})
```

`pdf-lib` is already a devDependency after Task 1. The 4th test writes its own small scratch PDF file next to the spec rather than reusing Task 1's fixture, since it needs Nubank-matching text instead of "fatura teste" — delete `test-fixtures-scratch-unencrypted.pdf` in an `afterAll` or add it to `.gitignore` under this directory; it is test scratch, never committed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && NODE_OPTIONS=--experimental-vm-modules pnpm test -- read-treasury-drive-file.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
import { readFile } from 'node:fs/promises'
import type { TreasurySource } from '@app/treasury-ingestion-contracts'
import { GOOGLE_SHEET_MIME } from '../../drive-source/constants/drive.constants'
import type { DriveClient } from '../../drive-source/services/drive-client'
import { readWorkbookRows, type SheetRows } from '../../ingestion/utils/read-workbook-rows'
import { extractPdfPages, PdfPasswordRequiredError, type PdfPage } from '../../treasury-ingestion/utils/pdf-text'
import { detectTreasurySheetSource } from './detect-source'
import { detectTreasuryPdfSource } from './detect-pdf-source'

const ZIP_MAGIC = Buffer.from([0x50, 0x4b]) // "PK"
const PDF_MAGIC = Buffer.from('%PDF')

export interface ReadAndClassifyResult {
  detectedSource: TreasurySource | null
  contentSha256: string
  sheets?: SheetRows[]
  pages?: PdfPage[]
}

/**
 * Reads a treasury Drive file's real content and classifies it, regardless of what Drive's own
 * `mimeType` claims. A real file found in the "Extratos" folder (the "pagseguro" folder's own
 * statement) is reported as `application/pdf` by Drive but its actual bytes are a zip/xlsx — so
 * this never trusts the claimed mimeType for anything except deciding whether `exportSheet`
 * (native Sheet only) is even possible; everything else is identified from its own real bytes.
 * Takes `fileId`/`mimeType` as scalars rather than a full `DriveItem`: the import path (Task 8)
 * only has these two persisted on `TreasuryDriveFile`, with no Drive call to refetch the rest.
 */
export async function readAndClassifyTreasuryDriveFile(
  client: DriveClient,
  fileId: string,
  mimeType: string,
  bankFolderName: string,
  destPath: string,
  maxBytes: number,
  pdfPassword: string | undefined,
): Promise<ReadAndClassifyResult> {
  if (mimeType === GOOGLE_SHEET_MIME) {
    const { sha256 } = await client.exportSheet(fileId, destPath, maxBytes)
    const sheets = await readWorkbookRows(destPath)
    return { detectedSource: detectTreasurySheetSource(sheets, bankFolderName), contentSha256: sha256, sheets }
  }

  const { sha256 } = await client.download(fileId, destPath, maxBytes)
  const bytes = await readFile(destPath)
  const magic = bytes.subarray(0, 4)

  if (magic.subarray(0, 2).equals(ZIP_MAGIC)) {
    const sheets = await readWorkbookRows(destPath)
    return { detectedSource: detectTreasurySheetSource(sheets, bankFolderName), contentSha256: sha256, sheets }
  }

  if (magic.equals(PDF_MAGIC)) {
    try {
      const pages = await extractPdfPages(bytes)
      return { detectedSource: detectTreasuryPdfSource(pages, bankFolderName), contentSha256: sha256, pages }
    } catch (error) {
      if (error instanceof PdfPasswordRequiredError && pdfPassword !== undefined) {
        const pages = await extractPdfPages(bytes, pdfPassword)
        return { detectedSource: detectTreasuryPdfSource(pages, bankFolderName), contentSha256: sha256, pages }
      }
      // Wrong/missing password, or any other read failure: unrecognized, never thrown further —
      // the metadata-based sha256 from `download` above is still a valid fingerprint for re-scan
      // change detection even though the content itself couldn't be read.
      return { detectedSource: null, contentSha256: sha256 }
    }
  }

  return { detectedSource: null, contentSha256: sha256 }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && NODE_OPTIONS=--experimental-vm-modules pnpm test -- read-treasury-drive-file.spec.ts`
Expected: PASS, all green, 7/7.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/read-treasury-drive-file.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/read-treasury-drive-file.spec.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): shared content-sniffing reader for treasury Drive files

Replaces the native-Sheet-only read path with real magic-byte detection,
so a mislabeled file (Drive reports application/pdf for a real zip/xlsx,
confirmed against the real PagBank file) and a password-protected PDF
(confirmed against the real C6 invoice file) both read correctly.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Persist `mime_type`, and wire the scan service to the shared reader

**Files:**
- Modify: `backend/apps/ingestion-worker-service/prisma/schema.prisma`
- Modify: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive.repository.ts`
- Modify: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive-scan.service.ts`
- Modify: `backend/apps/ingestion-worker-service/test/treasury-drive-scan.integration-spec.ts`

**Interfaces:**
- Consumes: `readAndClassifyTreasuryDriveFile` (Task 6), `TreasuryDriveConfig.pdfPassword` (Task 2).
- Produces: `TreasuryDriveRepository.upsertSeen`'s input gains `mimeType: string`, and every row it returns now carries a persisted `mime_type: string` column — consumed by Task 8, which has no other way to learn a tracked file's mimeType at import time (confirmed in this plan's own research: `DriveClient` has no "get one file's metadata by id" method, only `listFolder`).

- [ ] **Step 1: Add the `mime_type` column**

`TreasuryDriveFile` (`prisma/schema.prisma`) currently has no mimeType column at all — add one, required (every row the scan creates always has a real Drive mimeType available):

```prisma
model TreasuryDriveFile {
  id                  String    @id @default(uuid())
  drive_file_id       String    @unique
  month_folder_name   String
  bank_folder_name    String
  /// TreasurySource value once a signature matches; null = unrecognized, never imported.
  detected_source     String?
  name                String
  /// The Drive's own reported mimeType — the import job's only way to learn it again, since
  /// DriveClient has no "fetch one file's metadata by id" method, only listFolder.
  mime_type           String
  /// The Drive's own metadata — this IS the import's period source, never the folder name (no year in it).
  modified_time       DateTime
  content_sha256      String
  /// 'new' | 'changed' | 'importing' | 'imported' | 'ignored' | 'error'
  status              String    @default("new")
  imported_at         DateTime?
  imported_account_id Int?
  error_detail        String?
  created_at          DateTime  @default(now())
  updated_at          DateTime  @updatedAt

  @@map("treasury_drive_file")
}
```

Run: `cd backend/apps/ingestion-worker-service && pnpm prisma migrate dev --name add_treasury_drive_file_mime_type`
Expected: a new migration directory under `prisma/migrations/`, applied to the local dev Postgres without error (there are no existing production rows to backfill — this table has only ever held test/dev data so far).

- [ ] **Step 2: Update `TreasuryDriveRepository.upsertSeen`**

Read the current file in full (already quoted above from this plan's own research) before editing. Add `mimeType: string` to the input type and persist it on both the `create` and `update` branches:

```typescript
async upsertSeen(input: {
  driveFileId: string
  monthFolderName: string
  bankFolderName: string
  detectedSource: string | null
  name: string
  mimeType: string
  modifiedTime: Date
  contentSha256: string
}) {
  const existing = await this.prisma.treasuryDriveFile.findUnique({ where: { drive_file_id: input.driveFileId } })

  if (!existing) {
    return this.prisma.treasuryDriveFile.create({
      data: {
        drive_file_id: input.driveFileId,
        month_folder_name: input.monthFolderName,
        bank_folder_name: input.bankFolderName,
        detected_source: input.detectedSource,
        name: input.name,
        mime_type: input.mimeType,
        modified_time: input.modifiedTime,
        content_sha256: input.contentSha256,
        status: 'new',
      },
    })
  }

  if (existing.content_sha256 === input.contentSha256) return existing
  if (existing.status === 'imported' || existing.status === 'importing') return existing

  return this.prisma.treasuryDriveFile.update({
    where: { id: existing.id },
    data: { content_sha256: input.contentSha256, modified_time: input.modifiedTime, detected_source: input.detectedSource, mime_type: input.mimeType, status: 'changed' },
  })
}
```

No new test for this step alone — it has no observable behavior split from Task 7's own scan tests below, which exercise it through `TreasuryDriveScanService`.

- [ ] **Step 3: Write the failing integration tests**

Read the current integration spec in full (already quoted above from this plan's own research) — these two tests are added inside its existing `describe` block, reusing its `config()` factory and the real `xlsxBuffer` helper it already imports.

```typescript
it('tracks a real uploaded .xlsx (not a native Sheet) correctly, instead of marking it unrecognized', async () => {
  const client = InMemoryDriveClient.fromTree('root', {
    agosto: { c6: { 'extrato c6 agosto': xlsxBuffer([c6StatementSheet()]) } },
  })
  const repo = new TreasuryDriveRepository(prisma)
  const service = new TreasuryDriveScanService(repo)

  await service.scan(client, config())

  const [tracked] = await repo.list()
  expect(tracked).toMatchObject({ detected_source: 'c6_statement', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
})

it('tracks a Nubank PDF found in a recognized nubank bank folder', async () => {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 120])
  page.drawText('AGILIZ.AI LTDA', { x: 10, y: 90 })
  page.drawText('60.819.321/0001-44 0001  CNPJ Agência Conta', { x: 10, y: 60 })
  page.drawText('Movimentações', { x: 10, y: 30 })
  const pdfBytes = Buffer.from(await doc.save())

  const client = InMemoryDriveClient.fromTree('root', {
    agosto: { nubank: { 'extrato nubank agosto.pdf': { mimeType: 'application/pdf', content: pdfBytes } } },
  })
  const repo = new TreasuryDriveRepository(prisma)
  const service = new TreasuryDriveScanService(repo)

  await service.scan(client, config())

  const [tracked] = await repo.list()
  expect(tracked).toMatchObject({ detected_source: 'nubank_statement', bank_folder_name: 'nubank', mime_type: 'application/pdf' })
})
```

Note that `InMemoryDriveClient.fromTree`'s tree builder (`addTree`, confirmed in this plan's own research) treats a bare `Buffer`/`string` value as a plain file with the default `XLSX_MIME` — so the first test's `xlsxBuffer(...)` value does NOT need the `{ sheet: ... }` native-Sheet wrapper this time, unlike the file's other existing tests: it is deliberately a real non-native upload.

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && DATABASE_URL="postgresql://agiliz:agiliz-dev-secret@127.0.0.1:5438/ingestion" pnpm test:integration -- treasury-drive-scan.integration-spec.ts`
Expected: FAIL — the real uploaded xlsx and the Nubank PDF both currently come back `detected_source: null` (and `mime_type` doesn't exist on the row yet, a TypeScript error until Step 1/2 land — run this after Steps 1-2 are already in place, so the failure is purely behavioral).

- [ ] **Step 5: Implement the scan service's wiring**

Replace the per-file `try`/`catch` block's body (the one currently branching on `fileItem.mimeType === GOOGLE_SHEET_MIME`):

```typescript
let detectedSource: string | null = null
let contentSha256: string

try {
  const destPath = join(tmp, fileItem.id)
  const result = await readAndClassifyTreasuryDriveFile(client, fileItem.id, fileItem.mimeType, bankItem.name, destPath, TREASURY_DRIVE_MAX_FILE_BYTES, config.pdfPassword)
  detectedSource = result.detectedSource
  contentSha256 = result.contentSha256
} catch (error) {
  this.logger.warn(`Treasury Drive scan: could not read "${fileItem.name}" (${bankItem.name}/${monthItem.name}): ${(error as Error).message}`)
  detectedSource = null
  contentSha256 = metadataFingerprint(fileItem)
}
```

And pass the new field through to the repository call just below it:

```typescript
const result = await this.repository.upsertSeen({
  driveFileId: fileItem.id,
  monthFolderName: monthItem.name,
  bankFolderName: bankItem.name,
  detectedSource,
  name: fileItem.name,
  mimeType: fileItem.mimeType,
  modifiedTime: new Date(fileItem.modifiedTime),
  contentSha256,
})
```

Remove the now-unused `GOOGLE_SHEET_MIME`/`readWorkbookRows`/`detectTreasurySheetSource` imports from this file (they live inside the shared reader now) and add the import for `readAndClassifyTreasuryDriveFile`. Keep `metadataFingerprint` as the outer catch's fallback — the shared reader already has its own internal fallback for a password/unreadable PDF, but a totally unexpected throw (e.g. a network error from `download` itself) still needs this outer safety net, unchanged from today.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && DATABASE_URL="postgresql://agiliz:agiliz-dev-secret@127.0.0.1:5438/ingestion" pnpm test:integration -- treasury-drive-scan.integration-spec.ts`
Expected: PASS, all green including the 2 new ones.

- [ ] **Step 7: Run the whole service's test suite**

Run: `cd backend/apps/ingestion-worker-service && NODE_OPTIONS=--experimental-vm-modules pnpm test && DATABASE_URL="postgresql://agiliz:agiliz-dev-secret@127.0.0.1:5438/ingestion" pnpm test:integration`
Expected: PASS, all green.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/ingestion-worker-service/prisma/ backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive.repository.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive-scan.service.ts backend/apps/ingestion-worker-service/test/treasury-drive-scan.integration-spec.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): persist mime_type, scan now reads real xlsx/PDF files

The import job has no Drive call to refetch a single file's metadata by
id, so the scan now persists mime_type for it to reuse. The scan itself
now reads any format via the shared sniffing reader, not just native
Sheets.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire the import service to the shared reader and extended parser routing

**Files:**
- Modify: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive-import.service.ts`
- Modify: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/jobs/treasury-drive-import.worker.ts`
- Modify: `backend/apps/ingestion-worker-service/test/treasury-drive-import.integration-spec.ts`

**Interfaces:**
- Consumes: `readAndClassifyTreasuryDriveFile` (Task 6), `parsePagBankStatementSheet` (Task 5), `parseNubankStatement` (`../../treasury-ingestion/parsers/nubank.parser`, existing, signature `(pages: PdfPage[]): { rows: TreasuryRawRow[]; rejections: TreasuryRawRejection[] }`), `parseC6Invoice` (`../../treasury-ingestion/parsers/c6-invoice.parser`, existing, signature `(pages: PdfPage[], period: string): ParseStatementLinesResult` — the one parser in this routing map with a 2nd argument), `TreasuryDriveFile.mime_type` (Task 7, persisted column).
- Produces: `TreasuryDriveImportService.runImport` gains a 5th parameter, `pdfPassword: string | undefined` — consumed by `TreasuryDriveImportWorker.process`, which already holds the full `TreasuryDriveConfig` (confirmed in this plan's own research) and passes `this.config.pdfPassword` through.

- [ ] **Step 1: Write the failing integration tests**

Read the current `treasury-drive-import.service.ts` and `.integration-spec.ts` in full (already quoted above from this plan's own research) before editing. Add these 4 tests inside the existing `describe('runImport ...')` block, alongside the file's own `config`/`tracked`/`service` helpers (reused as-is):

```typescript
import { PDFDocument } from 'pdf-lib'

const PAGBANK_SHEET: SheetRows = {
  sheetName: 'Sheet1',
  rows: [
    ['Nome do Titular : AGILIZ.AI LTDA'],
    ['Banco : 290 - PagSeguro Internet S/A'],
    [],
    ['Data', 'Tipo', 'Descrição', 'Entradas', 'Saidas', 'Saldo'],
    ['01/09/2026', 'Vendas', 'Disponivel PIX', 5.86, null, null],
  ],
}

/** A real, short, PDF-lib-built PDF. `drawText` lines are placed top-to-bottom (decreasing y) so
 * pdf-parse extracts them in the same order they're listed here — if a future pdf-parse upgrade
 * ever changes that ordering, the RED step below will show lines out of order, not missing text;
 * widen the y gaps, don't change the assertions. */
async function buildPdf(lines: string[], password?: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([450, 50 + lines.length * 20])
  lines.forEach((line, i) => page.drawText(line, { x: 10, y: page.getHeight() - 30 - i * 20 }))
  if (password) await doc.encrypt({ userPassword: password, ownerPassword: password })
  return Buffer.from(await doc.save())
}

it('imports a C6 invoice found as a password-protected PDF (the real September case), using the PDF parser', async () => {
  const pdfBytes = await buildPdf(
    ['Ola, AGILIZ.AI LTDA! Sua fatura com', 'vencimento em Outubro chegou', '05 set Compra Mercado 150,00'],
    'inv-test-pw',
  )
  const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'fatura c6 setembro.pdf': { mimeType: 'application/pdf', content: pdfBytes } } } })
  const file = await tracked(client)
  await repo.claimForImporting(file.id)

  const result = await service().runImport(file.id, client, 42, '2026-10', 'inv-test-pw')

  expect(result?.status).toBe('imported')
  expect(published[0].message.source).toBe('c6_invoice')
  expect(published[0].message.rows).toHaveLength(1)
  expect(published[0].message.rows[0]).toMatchObject({ occurredOn: '2026-09-05', amountCents: 15000, direction: 'outflow' })
  const [, , contentType] = s3.uploadFile.mock.calls[0]
  expect(contentType).toBe('application/pdf')
})

it('imports a Nubank statement found as a PDF, using parseNubankStatement', async () => {
  const pdfBytes = await buildPdf([
    'AGILIZ.AI LTDA',
    '60.819.321/0001-44 0001  CNPJ Agência Conta',
    'Movimentações',
    '01 SET 2026 Total de entradas +100,00',
    'PIX recebido JOAO 100,00',
  ])
  const client = InMemoryDriveClient.fromTree('root', { agosto: { nubank: { 'extrato nubank.pdf': { mimeType: 'application/pdf', content: pdfBytes } } } })
  const file = await tracked(client)
  await repo.claimForImporting(file.id)

  const result = await service().runImport(file.id, client, 42, '2026-09', undefined)

  expect(result?.status).toBe('imported')
  expect(published[0].message.source).toBe('nubank_statement')
  expect(published[0].message.rows).toHaveLength(1)
  expect(published[0].message.rows[0]).toMatchObject({ occurredOn: '2026-09-01', amountCents: 10000, direction: 'inflow' })
})

it('imports a PagBank statement found as a mislabeled-PDF xlsx, using parsePagBankStatementSheet', async () => {
  const client = InMemoryDriveClient.fromTree('root', { agosto: { pagseguro: { 'extrato.pdf': { mimeType: 'application/pdf', content: xlsxBuffer([PAGBANK_SHEET]) } } } })
  const file = await tracked(client)
  await repo.claimForImporting(file.id)

  const result = await service().runImport(file.id, client, 42, '2026-09', undefined)

  expect(result?.status).toBe('imported')
  expect(published[0].message.source).toBe('pagbank_statement')
  expect(published[0].message.rows).toHaveLength(1)
  expect(published[0].message.rows[0]).toMatchObject({ amountCents: 586, direction: 'inflow' })
  const [, , contentType] = s3.uploadFile.mock.calls[0]
  expect(contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
})

it('refuses import with "unrecognized" when a password-protected file has no configured password', async () => {
  const pdfBytes = await buildPdf(['Ola, AGILIZ.AI LTDA! Sua fatura com', 'vencimento em Outubro chegou'], 'inv-test-pw')
  const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'fatura c6.pdf': { mimeType: 'application/pdf', content: pdfBytes } } } })
  const file = await tracked(client)
  await repo.claimForImporting(file.id)

  await expect(service().runImport(file.id, client, 42, '2026-10', undefined)).rejects.toMatchObject({
    response: expect.objectContaining({ code: 'unrecognized' }),
  })

  expect(published).toHaveLength(0)
  const after = await repo.findById(file.id)
  expect(after?.status).toBe('error')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && DATABASE_URL="postgresql://agiliz:agiliz-dev-secret@127.0.0.1:5438/ingestion" pnpm test:integration -- treasury-drive-import.integration-spec.ts`
Expected: FAIL — `runImport` doesn't take a 5th argument yet, and the Nubank/PagBank/password-protected C6 files all currently import as (or fail as) `c6_statement`/`itau_statement`/`unrecognized` via the old 3-source `PARSERS` map.

- [ ] **Step 3: Implement**

Replace the `PARSERS` map and its doc comment:

```typescript
import { parseNubankStatement } from '../../treasury-ingestion/parsers/nubank.parser'
import { parseC6Invoice } from '../../treasury-ingestion/parsers/c6-invoice.parser'
import { parsePagBankStatementSheet } from '../parsers/pagbank-statement-sheet.parser'
import { readAndClassifyTreasuryDriveFile } from '../utils/read-treasury-drive-file'

/** Sheet-formatted sources — read via `readWorkbookRows`, parsed by row/column name. */
const SHEET_PARSERS = {
  itau_statement: parseItauStatementSheet,
  c6_statement: parseC6StatementSheet,
  c6_invoice: parseC6InvoiceSheet,
  pagbank_statement: parsePagBankStatementSheet,
} as const

/** PDF-formatted sources — read via `extractPdfPages`, parsed by line/text pattern. `c6_invoice`
 * is the one source reachable through EITHER map (a native Sheet one month, a password-protected
 * PDF the next — both real, confirmed against the real September file). */
const PDF_PARSERS = {
  nubank_statement: parseNubankStatement,
  c6_invoice: parseC6Invoice,
} as const
```

In `runImport`, add the `pdfPassword` parameter and replace the `exportSheet`/`readWorkbookRows`/`detectTreasurySheetSource` block:

```typescript
async runImport(id: string, client: DriveClient, accountId: number, period: string, pdfPassword: string | undefined): Promise<{ status: 'imported'; jobId: string } | undefined> {
  const file = await this.repository.findById(id)
  if (!file || file.status !== 'importing') return undefined

  try {
    const tmp = mkdtempSync(join(tmpdir(), 'treasury-drive-import-'))
    const destPath = join(tmp, file.drive_file_id)

    try {
      const result = await readAndClassifyTreasuryDriveFile(client, file.drive_file_id, file.mime_type, file.bank_folder_name, destPath, TREASURY_DRIVE_MAX_FILE_BYTES, pdfPassword)

      if (!result.detectedSource) {
        await this.repository.markError(id, 'Re-check at import time found no recognizable signature')
        throw new BadRequestException({ code: 'unrecognized' })
      }

      const detectedSource = result.detectedSource
      const { rows, rejections } = result.sheets
        ? SHEET_PARSERS[detectedSource as keyof typeof SHEET_PARSERS](result.sheets[0].rows)
        : PDF_PARSERS[detectedSource as keyof typeof PDF_PARSERS](result.pages!, period)

      const bytes = await readFile(destPath)
      const originalName = extname(file.name) === '' ? `${file.name}.xlsx` : file.name
      const objectKey = `treasury-imports/${period}/${detectedSource}/${randomUUID()}-${originalName.replace(/[\\/]/g, '_')}`
      const contentType = result.sheets ? XLSX_MIME : 'application/pdf'
      await this.s3.uploadFile(objectKey, bytes, contentType)

      const job: TreasuryRawRowsJob = { schemaVersion: 1, source: detectedSource, accountId, period, objectKey, rows, rejections }
      const published = await this.broker.holdIt({ queueName: TREASURY_QUEUES.RAW_ROWS, message: job, options: { attempts: 1 } })
      await this.repository.markImported(id, accountId)

      return { status: 'imported' as const, jobId: String(published.id ?? '') }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      await this.repository.markError(id, (error as Error).message)
    }
    throw error
  }
}
```

`PDF_PARSERS.c6_invoice` is `parseC6Invoice` directly (its real signature already is `(pages, period)`) — no wrapper needed; `SHEET_PARSERS[...]` parsers all take just `(rows)`, so the call-site ternary passes `period` as the 2nd argument unconditionally, which every `SHEET_PARSERS` function ignores (extra argument, not a type error) and every `PDF_PARSERS` function except `parseNubankStatement` uses — `parseNubankStatement(pages, period)` also ignores the unused 2nd argument harmlessly, same reasoning.

Then update the worker to pass the config value through:

```typescript
return this.imports.runImport(job.data.fileId, client, job.data.accountId, job.data.period, this.config.pdfPassword)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && DATABASE_URL="postgresql://agiliz:agiliz-dev-secret@127.0.0.1:5438/ingestion" pnpm test:integration -- treasury-drive-import.integration-spec.ts`
Expected: PASS, all green including the 4 new ones.

- [ ] **Step 5: Run the whole service's test suite**

Run: `cd backend/apps/ingestion-worker-service && NODE_OPTIONS=--experimental-vm-modules pnpm test && DATABASE_URL="postgresql://agiliz:agiliz-dev-secret@127.0.0.1:5438/ingestion" pnpm test:integration`
Expected: PASS, all green.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive-import.service.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/jobs/treasury-drive-import.worker.ts backend/apps/ingestion-worker-service/test/treasury-drive-import.integration-spec.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): import routes Nubank/PagBank/C6-invoice-PDF to the right parser

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Documentation and env wiring

**Files:**
- Modify: `backend/apps/ingestion-worker-service/CLAUDE.md`
- Modify: `.env.example` (repo root)

**Interfaces:**
- Consumes: the finished state of Tasks 1-8.
- Produces: nothing for later tasks.

- [ ] **Step 1: Update "A fonte Drive de tesouraria" in `ingestion-worker-service/CLAUDE.md`**

Add: Nubank and PagBank now covered (PDF and mislabeled-PDF-xlsx respectively — both reusing the existing manual-upload parsers, except PagBank's new sheet-specific parser); the real month-folder naming convention observed includes a year suffix (`agosto-26`, not bare `agosto` — `TREASURY_DRIVE_MONTH_FOLDERS` must be updated by hand whenever the operator's own folder-naming convention changes, same "manual allowlist" principle as before); the new `TREASURY_DRIVE_PDF_PASSWORD` env var and why only C6's invoice needed it (Nubank's real file has no password). Cross-reference this plan and spec by path.

- [ ] **Step 2: Document the env vars in `.env.example`**

Add `TREASURY_DRIVE_PDF_PASSWORD` next to the existing treasury Drive block, commented, noting it's only consulted when a PDF the scan/import reads actually requires one.

- [ ] **Step 3: Commit**

```bash
git add backend/apps/ingestion-worker-service/CLAUDE.md .env.example
git commit -m "$(cat <<'EOF'
docs: document treasury Drive multi-bank coverage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 (manual, not part of the automated loop): real acceptance against the real Drive folder

Same principle as the original treasury Drive sync plan's own Task 17. Requires `TREASURY_DRIVE_PDF_PASSWORD` set for real, the service rebuilt via `agiliz-cli up -i ingestion` (never a raw `docker compose up`, which drops the root `.env`'s shared Drive credential — confirmed as a real incident during this exact feature's own rollout), and the operator watching the real `/treasury/imports` screen.

**Steps:**
1. Confirm `TREASURY_DRIVE_MONTH_FOLDERS` still matches the real, current folder names (re-check — they may have changed again since this plan was written).
2. Click "Sincronizar agora"; confirm Nubank and PagBank's September files now show a real detected type instead of "não reconhecido", alongside Itaú/C6's real `.xlsx` files (also previously "não reconhecido", now recognized).
3. Click "Importar" on each; confirm the resulting row in the existing "Importar extratos" table matches the file's real bank/period.
4. Confirm Bradesco's folder (not in the allowlist) never appears at all, not even as unrecognized.

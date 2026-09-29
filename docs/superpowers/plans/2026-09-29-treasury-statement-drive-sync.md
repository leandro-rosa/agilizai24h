# Treasury statement Drive sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator sync Itaú statement and C6 statement/invoice files from a Google Drive folder ("Extratos") straight into `/treasury/imports`'s existing "Importar extratos" screen, the same "scan, review, confirm, import" experience sales/abastecimento already has — instead of a manual monthly upload or asking Claude to run it by hand.

**Architecture:** A new, parallel `treasury-drive-source` module in `ingestion-worker-service` (not inside the existing `drive-source` module — deliberately not generalizing its sales-specific coverage validation). It scans a second Drive root two levels deep (month folder → bank folder → file), detects Itaú/C6-statement/C6-invoice by content signature, and on operator confirmation (bank account + period) writes through 3 new parsers into the exact same `treasury.raw-rows` queue the 7 existing PDF-based parsers already feed — `treasury-service` needs zero changes.

**Tech Stack:** NestJS, Prisma, BullMQ (`@app/hold-it`), `@googleapis/drive` (already a dependency), Next.js/RTK Query (admin frontend).

**Spec:** [docs/superpowers/specs/2026-09-29-treasury-statement-drive-sync-design.md](../specs/2026-09-29-treasury-statement-drive-sync-design.md)

## Global Constraints

- Zero changes to `treasury-service` — new rows use the exact existing `TreasuryRawRow`/`TreasuryRawRowsJob` contract (`@app/treasury-ingestion-contracts`), unchanged.
- Classification (`nature`/category) is never decided by a parser here — the operator's own "Tipo"/"Detalhe" columns in the source sheets are never read into `structuralHint` or any other field. `structuralHint` is reserved for facts the file's own structure fixes independent of counterparty (see `c6-statement.parser.ts`'s `PATTERNS`).
- `accountId`/`period` are never guessed from the file or the folder name — the operator confirms both before any write. `period` is suggested from the file's real Drive `modifiedTime`, never parsed from the month folder's name (which carries no year).
- Only Google Drive folders explicitly named in `TREASURY_DRIVE_MONTH_FOLDERS` are ever scanned — no smart date-range computation, no pattern-matching a folder name that merely "looks like" a month.
- Format detection is content-based only, never by filename.
- The `drive-source` module's existing files, schema, and tests are not modified except where explicitly named (Task 1's helper extraction, Task 11's `REGISTERED_QUEUES`).

## Review Focus

- **A file whose content matches no known signature** (a stray spreadsheet, a half-edited sheet) — must be listed as unrecognized and never imported, not silently skipped from the list nor guessed as the "closest" type. Task 4's detector tests cover this explicitly.
- **A C6 invoice row whose "Parcela" cell is a serialized date** (Excel auto-formatting quirk observed in the real file) — must parse the row (coercing the date back to its likely text) rather than crash or silently drop it. Task 7's parser test covers this with the exact real value observed.
- **Re-running the scan against an unchanged file** — must not flip its status away from `imported` or re-list it as `new`; only a real content change (different hash) does that. Task 8's scan-service tests cover a second scan of an untouched tree.
- **The month-folder allowlist excluding a real folder** (e.g. "julho", present in the real Drive tree but not in `TREASURY_DRIVE_MONTH_FOLDERS`) — must never surface those files at all, not even as "unrecognized". Task 8's scan tests cover a tree with an extra, non-allowlisted month folder.
- **Importing the same file twice** (operator double-clicks, or re-imports after already confirming) — must be refused with a clear reason, never create a second `treasury.raw-rows` job for the same content. Task 9's import-service tests cover a second import attempt on an already-`imported` file.

---

## File Structure

**Backend — `ingestion-worker-service`** (new module, one small extraction from `drive-source`):
- `src/modules/drive-source/config/drive.config.ts` — extend only: export the credential-parsing helper (Task 1).
- `src/modules/treasury-drive-source/config/treasury-drive.config.ts` — new.
- `src/modules/treasury-drive-source/constants/treasury-drive.constants.ts` — new (queue names, month/bank allowlists' types, statuses).
- `prisma/schema.prisma` — add `TreasuryDriveFile` model; new migration.
- `src/modules/treasury-drive-source/utils/month-folder-allowlist.ts` — new, pure.
- `src/modules/treasury-drive-source/utils/detect-source.ts` — new, pure.
- `src/modules/treasury-drive-source/parsers/itau-statement-sheet.parser.ts` — new.
- `src/modules/treasury-drive-source/parsers/c6-statement-sheet.parser.ts` — new.
- `src/modules/treasury-drive-source/parsers/c6-invoice-sheet.parser.ts` — new.
- `src/modules/treasury-drive-source/services/treasury-drive-scan.service.ts` — new.
- `src/modules/treasury-drive-source/jobs/treasury-drive-scan.worker.ts` — new.
- `src/modules/treasury-drive-source/services/treasury-drive-import.service.ts` — new.
- `src/modules/treasury-drive-source/jobs/treasury-drive-import.worker.ts` — new.
- `src/modules/treasury-drive-source/services/treasury-drive.repository.ts` — new.
- `src/modules/treasury-drive-source/services/treasury-drive.producer.ts` — new.
- `src/modules/treasury-drive-source/services/treasury-drive-scheduler.service.ts` — new.
- `src/modules/treasury-drive-source/dto/treasury-drive-files.dto.ts` — new.
- `src/modules/treasury-drive-source/controllers/treasury-drive-files.controller.ts` — new.
- `src/modules/treasury-drive-source/treasury-drive-source.module.ts` — new.
- `src/registered-queues.ts`, `src/registered-queues.spec.ts` — extend.
- `src/app.module.ts` — register the new module.

**Backend — `gateway-service`** (extend, no new files):
- `src/modules/domains/controllers/treasury.controller.ts` — new proxy routes (or a new small controller file if the existing one doesn't already group treasury routes — confirmed inside Task 12).

**Frontend — `admin`**:
- `src/lib/api/treasury.ts` — extend: new types, new endpoints.
- `src/components/treasury/drive-files-section.tsx` — new.
- `src/components/treasury/drive-file-row.tsx` — new.
- `src/components/treasury/drive-import-dialog.tsx` — new.
- `src/app/(app)/treasury/imports/page.tsx` — extend: mount the new section.

---

## Task 1: Extract the Drive credential-parsing helper

**Files:**
- Modify: `backend/apps/ingestion-worker-service/src/modules/drive-source/config/drive.config.ts`
- Test: `backend/apps/ingestion-worker-service/src/modules/drive-source/config/drive.config.spec.ts` (existing file — extend)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `parseDriveCredential(source: Record<string, unknown>): { credential: DriveCredential | undefined; problems: string[] }` — exported from `drive.config.ts`, consumed by Task 2's `loadTreasuryDriveConfig`.

- [ ] **Step 1: Read the current file in full**

Read `backend/apps/ingestion-worker-service/src/modules/drive-source/config/drive.config.ts` (178 lines) and its existing spec file in full. Confirm the exact credential-parsing block: the `base64`/`file` mutual-exclusion check, the JSON-decode-and-shape-check for `base64`, the `fileExists` check for `file`, and the `hasFolder`/`hasCredential` cross-check — this is the block to extract (roughly lines 84–116 of the file as read during this plan's own research; re-read now, since a concurrent edit could have moved it).

- [ ] **Step 2: Write the failing test for the extracted function**

Add to the existing spec file:

```typescript
import { parseDriveCredential } from './drive.config'

describe('parseDriveCredential', () => {
  it('parses a valid base64 service account key', () => {
    const key = Buffer.from(JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: 'x' })).toString('base64')
    const { credential, problems } = parseDriveCredential({ GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: key })
    expect(problems).toEqual([])
    expect(credential).toEqual({ kind: 'base64', value: key })
  })

  it('reports a problem when base64 does not decode to a service account shape', () => {
    const bad = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64')
    const { credential, problems } = parseDriveCredential({ GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: bad })
    expect(credential).toBeUndefined()
    expect(problems.length).toBeGreaterThan(0)
  })

  it('reports a problem when both base64 and file are set', () => {
    const { problems } = parseDriveCredential({ GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: 'x', GOOGLE_SERVICE_ACCOUNT_FILE: '/tmp/key.json' })
    expect(problems.length).toBeGreaterThan(0)
  })

  it('returns no credential and no problem when neither is set', () => {
    const { credential, problems } = parseDriveCredential({})
    expect(credential).toBeUndefined()
    expect(problems).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- drive.config.spec.ts`
Expected: FAIL — `parseDriveCredential` is not exported.

- [ ] **Step 3: Extract the function, keeping `loadDriveConfig`'s behavior identical**

In `drive.config.ts`, pull the credential-parsing block into a standalone exported function, and have `loadDriveConfig` call it:

```typescript
export function parseDriveCredential(source: Source): { credential: DriveCredential | undefined; problems: string[] } {
  const problems: string[] = []
  const base64 = text(source, 'GOOGLE_SERVICE_ACCOUNT_JSON_BASE64')
  const file = text(source, 'GOOGLE_SERVICE_ACCOUNT_FILE')
  let credential: DriveCredential | undefined

  if (base64 !== undefined && file !== undefined) {
    problems.push('set only one of GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 and GOOGLE_SERVICE_ACCOUNT_FILE')
  } else if (base64 !== undefined) {
    try {
      const parsed = JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as Record<string, unknown>
      if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
        problems.push('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 must decode to a service account key with client_email and private_key')
      } else {
        credential = { kind: 'base64', value: base64 }
      }
    } catch {
      problems.push('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64-encoded JSON')
    }
  }
  // file-only branch needs fileExists, which loadDriveConfig has as a parameter —
  // keep that branch in loadDriveConfig itself; parseDriveCredential covers the
  // base64 path and the mutual-exclusion check, which is what treasury-drive.config.ts needs.

  return { credential, problems }
}
```

Re-read the real file before editing: the `file`-credential branch calls the injected `fileExists` parameter, which this extracted function does not take. Keep that one branch (the `else if (file !== undefined)` block) inline in `loadDriveConfig`, calling `parseDriveCredential` first for the base64/mutual-exclusion part, then handling `file` separately exactly as today. Wire `loadDriveConfig` to use `parseDriveCredential(source).credential`/`.problems` for the base64 case, preserving every existing behavior and error message string exactly — this step must not change what `loadDriveConfig`'s own existing tests assert.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- drive.config.spec.ts`
Expected: PASS, all tests including the pre-existing ones for `loadDriveConfig`.

- [ ] **Step 5: Run the whole service's test suite to confirm nothing else broke**

Run: `cd backend/apps/ingestion-worker-service && pnpm test`
Expected: PASS, same count as before this task plus the 4 new tests.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/drive-source/config/drive.config.ts backend/apps/ingestion-worker-service/src/modules/drive-source/config/drive.config.spec.ts
git commit -m "$(cat <<'EOF'
refactor(ingestion-worker): extract parseDriveCredential from loadDriveConfig

The treasury Drive sync module needs the same base64 service-account
parsing/validation, without the rest of DriveConfig's sales-specific
thresholds. No behavior change to loadDriveConfig itself.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `loadTreasuryDriveConfig` and constants

**Files:**
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/config/treasury-drive.config.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/config/treasury-drive.config.spec.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/constants/treasury-drive.constants.ts`

**Interfaces:**
- Consumes: `parseDriveCredential` (Task 1), `DriveCredential` type (`drive-source/config/drive.config.ts`).
- Produces: `TreasuryDriveConfig { enabled: boolean; rootFolderId?: string; credential?: DriveCredential; monthFolders: string[]; scanCron: string }`, `loadTreasuryDriveConfig(source: Record<string, unknown>): TreasuryDriveConfig`, `TREASURY_DRIVE_CONFIG` (DI token), `TREASURY_DRIVE_QUEUES = { SCAN: 'treasury-drive.scan', IMPORT: 'treasury-drive.import' }`, `TREASURY_DRIVE_SCHEDULER_ID`, `TREASURY_DRIVE_FILE_STATUSES = ['new', 'changed', 'importing', 'imported', 'ignored', 'error'] as const` (no `missing` — a file vanishing from Drive is not a state this simpler tracker needs to represent specially; a vanished file just stops being listed on the next scan).

- [ ] **Step 1: Write the failing tests**

```typescript
import { loadTreasuryDriveConfig } from './treasury-drive.config'

describe('loadTreasuryDriveConfig', () => {
  const validCredential = Buffer.from(JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: 'x' })).toString('base64')

  it('is disabled when neither the folder nor the credential is set', () => {
    const config = loadTreasuryDriveConfig({})
    expect(config.enabled).toBe(false)
  })

  it('is enabled when both the folder and a valid credential are set', () => {
    const config = loadTreasuryDriveConfig({
      TREASURY_DRIVE_ROOT_FOLDER_ID: 'folder-1',
      GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: validCredential,
    })
    expect(config.enabled).toBe(true)
    expect(config.rootFolderId).toBe('folder-1')
  })

  it('parses the month-folder allowlist from a comma-separated string, trimmed', () => {
    const config = loadTreasuryDriveConfig({
      TREASURY_DRIVE_ROOT_FOLDER_ID: 'folder-1',
      GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: validCredential,
      TREASURY_DRIVE_MONTH_FOLDERS: 'agosto, setembro ,outubro',
    })
    expect(config.monthFolders).toEqual(['agosto', 'setembro', 'outubro'])
  })

  it('defaults the month-folder allowlist to an empty list, never guessing one', () => {
    const config = loadTreasuryDriveConfig({
      TREASURY_DRIVE_ROOT_FOLDER_ID: 'folder-1',
      GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: validCredential,
    })
    expect(config.monthFolders).toEqual([])
  })

  it('defaults scanCron to the same 06:00 America/Sao_Paulo schedule sales/abastecimento uses', () => {
    const config = loadTreasuryDriveConfig({ TREASURY_DRIVE_ROOT_FOLDER_ID: 'folder-1', GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: validCredential })
    expect(config.scanCron).toBe('0 6 * * *')
  })

  it('throws naming the problem when the credential is malformed', () => {
    expect(() =>
      loadTreasuryDriveConfig({ TREASURY_DRIVE_ROOT_FOLDER_ID: 'folder-1', GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: 'not-base64-json' }),
    ).toThrow(/GOOGLE_SERVICE_ACCOUNT_JSON_BASE64/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- treasury-drive.config.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the constants file**

```typescript
export const TREASURY_DRIVE_QUEUES = {
  SCAN: 'treasury-drive.scan',
  IMPORT: 'treasury-drive.import',
} as const

export const TREASURY_DRIVE_SCHEDULER_ID = 'treasury-drive-scan'
export const TREASURY_DRIVE_TIME_ZONE = 'America/Sao_Paulo'
export const TREASURY_DRIVE_DEFAULT_SCAN_CRON = '0 6 * * *'
export const TREASURY_DRIVE_MAX_FILE_BYTES = 25 * 1024 * 1024

export const TREASURY_DRIVE_FILE_STATUSES = ['new', 'changed', 'importing', 'imported', 'ignored', 'error'] as const
export type TreasuryDriveFileStatus = (typeof TREASURY_DRIVE_FILE_STATUSES)[number]
```

- [ ] **Step 4: Implement `loadTreasuryDriveConfig`**

```typescript
import { parseDriveCredential, type DriveCredential } from '../../drive-source/config/drive.config'
import { TREASURY_DRIVE_DEFAULT_SCAN_CRON } from '../constants/treasury-drive.constants'

export interface TreasuryDriveConfig {
  enabled: boolean
  rootFolderId?: string
  credential?: DriveCredential
  monthFolders: string[]
  scanCron: string
}

export const TREASURY_DRIVE_CONFIG = Symbol('TREASURY_DRIVE_CONFIG')

type Source = Record<string, unknown>

const text = (source: Source, name: string): string | undefined => {
  const value = source[name]
  if (value === undefined || value === null) return undefined
  const trimmed = String(value).trim()
  return trimmed === '' ? undefined : trimmed
}

export function loadTreasuryDriveConfig(source: Source): TreasuryDriveConfig {
  const rootFolderId = text(source, 'TREASURY_DRIVE_ROOT_FOLDER_ID')
  const { credential, problems } = parseDriveCredential(source)

  if (problems.length > 0) {
    throw new Error(`Invalid treasury Drive configuration:\n- ${problems.join('\n- ')}`)
  }

  const monthFolders = (text(source, 'TREASURY_DRIVE_MONTH_FOLDERS') ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(name => name !== '')

  return {
    enabled: rootFolderId !== undefined && credential !== undefined,
    rootFolderId,
    credential,
    monthFolders,
    scanCron: text(source, 'TREASURY_DRIVE_SCAN_CRON') ?? TREASURY_DRIVE_DEFAULT_SCAN_CRON,
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- treasury-drive.config.spec.ts`
Expected: PASS, 7/7.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/config/ backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/constants/
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): treasury Drive source config and constants

Reuses drive-source's credential parsing (Task 1's extraction) with its
own root folder, month-folder allowlist and scan-cron env vars — no
coverage/validation thresholds, since a whole-month bank statement has
no partial-coverage concept.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `TreasuryDriveFile` schema and migration

**Files:**
- Modify: `backend/apps/ingestion-worker-service/prisma/schema.prisma`
- Create: `backend/apps/ingestion-worker-service/prisma/migrations/<ts>_treasury_drive_file/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: the `TreasuryDriveFile` Prisma model, consumed by Task 8 (scan) and Task 9 (import) via `PrismaClientService`.

- [ ] **Step 1: Read the real schema and the existing `DriveFile` model for structural reference**

Read `backend/apps/ingestion-worker-service/prisma/schema.prisma` in full. `DriveFile` is the closest existing precedent for field naming conventions in this file (snake_case columns, `@unique` on the Drive id) — do not copy its validation-specific fields, this model has none.

- [ ] **Step 2: Add the model**

```prisma
/// Tracks a file the treasury Drive scan has seen inside Extratos/<mês>/<banco>/.
/// Deliberately no validation_status/validation_report — there is no coverage
/// concept for a whole-month bank statement to validate (see design's "Non-goals").
model TreasuryDriveFile {
  id                  String    @id @default(uuid())
  drive_file_id       String    @unique
  month_folder_name   String
  bank_folder_name    String
  /// TreasurySource value once a signature matches; null = unrecognized, never imported.
  detected_source     String?
  name                String
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

- [ ] **Step 3: Generate and apply the migration**

Run: `cd backend/apps/ingestion-worker-service && pnpm exec prisma migrate dev --name treasury_drive_file`
Expected: a new migration directory is created; `migration.sql` contains `CREATE TABLE "treasury_drive_file" (...)`.

- [ ] **Step 4: Confirm the Prisma client regenerated cleanly**

Run: `cd backend/apps/ingestion-worker-service && pnpm exec tsc -p tsconfig.app.json --composite false --noEmit`
Expected: clean (no errors referencing `TreasuryDriveFile` — confirms the generated client picked up the new model).

- [ ] **Step 5: Commit**

```bash
git add backend/apps/ingestion-worker-service/prisma/
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): add TreasuryDriveFile schema and migration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Month-folder allowlist and format-signature detection (pure functions)

**Files:**
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/month-folder-allowlist.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/month-folder-allowlist.spec.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/detect-source.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/detect-source.spec.ts`

**Interfaces:**
- Consumes: `SheetRows` type (`ingestion/utils/read-workbook-rows.ts`), `TreasurySource` type (`@app/treasury-ingestion-contracts`).
- Produces: `isAllowedMonthFolder(name: string, allowlist: string[]): boolean`, `isRecognizedBankFolder(name: string): boolean` (returns true for `'itau' | 'c6'`, case-insensitive — the only two this phase handles, per the spec's own Non-goals), `detectTreasurySheetSource(sheets: SheetRows[], bankFolderName: string): TreasurySource | null`.

- [ ] **Step 1: Write the failing tests for the allowlist functions**

```typescript
import { isAllowedMonthFolder, isRecognizedBankFolder } from './month-folder-allowlist'

describe('isAllowedMonthFolder', () => {
  it('matches a name in the allowlist, case-insensitively', () => {
    expect(isAllowedMonthFolder('Agosto', ['agosto', 'setembro'])).toBe(true)
    expect(isAllowedMonthFolder('agosto', ['agosto', 'setembro'])).toBe(true)
  })

  it('does not match a real month name outside the allowlist (e.g. julho, present in the real Drive tree but before the cutover)', () => {
    expect(isAllowedMonthFolder('julho', ['agosto', 'setembro'])).toBe(false)
  })

  it('does not match an unrelated folder name (legacy items like "Cartões" or a bank-prefixed multi-month folder)', () => {
    expect(isAllowedMonthFolder('Cartões', ['agosto'])).toBe(false)
    expect(isAllowedMonthFolder('nubank janeiro a agosto', ['agosto'])).toBe(false)
  })
})

describe('isRecognizedBankFolder', () => {
  it('recognizes itau and c6, case-insensitively', () => {
    expect(isRecognizedBankFolder('itau')).toBe(true)
    expect(isRecognizedBankFolder('C6')).toBe(true)
  })

  it('does not recognize a bank not covered by this phase', () => {
    expect(isRecognizedBankFolder('nubank')).toBe(false)
  })

  it('does not recognize a non-bank folder (noise like "comprovantes itau" living at the wrong level)', () => {
    expect(isRecognizedBankFolder('comprovantes itau')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- month-folder-allowlist.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
const RECOGNIZED_BANK_FOLDERS = ['itau', 'c6']

export function isAllowedMonthFolder(name: string, allowlist: string[]): boolean {
  const normalized = name.trim().toLowerCase()
  return allowlist.some(allowed => allowed.trim().toLowerCase() === normalized)
}

export function isRecognizedBankFolder(name: string): boolean {
  return RECOGNIZED_BANK_FOLDERS.includes(name.trim().toLowerCase())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- month-folder-allowlist.spec.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Write the failing tests for format detection**

```typescript
import { detectTreasurySheetSource } from './detect-source'
import type { SheetRows } from '../../ingestion/utils/read-workbook-rows'

function sheet(rows: unknown[][]): SheetRows[] {
  return [{ sheetName: 'Sheet1', rows }]
}

describe('detectTreasurySheetSource', () => {
  it('detects an Itaú statement by its Agência/Conta/Período header block', () => {
    const rows = [
      [null, null, null],
      ['Atualização:', '15/09/2026 09:39:30', null],
      ['Nome:', 'F&R SOLUCOES EXPERIENCE', null],
      ['Agência:', '2059', null],
      ['Conta:', '0099676-5', null],
      [null, null, null],
      ['Lançamentos', null, null],
      ['Periodo:', '01/08/2026 até 31/08/2026', null],
    ]
    expect(detectTreasurySheetSource(sheet(rows), 'itau')).toBe('itau_statement')
  })

  it('detects a C6 statement by its Entrada(R$)/Saída(R$) header row', () => {
    const rows = [['Data Lançamento', 'Data Contábil', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)', 'Tipo', 'Detalhe']]
    expect(detectTreasurySheetSource(sheet(rows), 'c6')).toBe('c6_statement')
  })

  it('detects a C6 invoice by its Nome no Cartão/Valor (em R$) header row', () => {
    const rows = [['Data de Compra', 'Nome no Cartão', 'Final do Cartão', 'Categoria', 'Descrição', 'Parcela', 'Valor (em US$)', 'Cotação (em R$)', 'Valor (em R$)', 'Tipo', 'detalhe']]
    expect(detectTreasurySheetSource(sheet(rows), 'c6')).toBe('c6_invoice')
  })

  it('returns null for a sheet matching no known signature — never guesses', () => {
    const rows = [['Something', 'Unrelated', 'Header']]
    expect(detectTreasurySheetSource(sheet(rows), 'c6')).toBeNull()
  })

  it('returns null when the bank folder is not one this phase recognizes', () => {
    const rows = [['Data Lançamento', 'Data Contábil', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)', 'Tipo', 'Detalhe']]
    expect(detectTreasurySheetSource(sheet(rows), 'nubank')).toBeNull()
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- detect-source.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement**

```typescript
import type { SheetRows } from '../../ingestion/utils/read-workbook-rows'
import type { TreasurySource } from '@app/treasury-ingestion-contracts'

const SEARCH_WINDOW = 15

function rowHasAll(row: unknown[], labels: string[]): boolean {
  const cells = row.map(cell => String(cell ?? '').trim())
  return labels.every(label => cells.some(cell => cell.includes(label)))
}

function matchesItauStatement(rows: unknown[][]): boolean {
  return rows.slice(0, SEARCH_WINDOW).some(row => rowHasAll(row, ['Agência:']) || rowHasAll(row, ['Conta:']))
    && rows.slice(0, SEARCH_WINDOW).some(row => rowHasAll(row, ['Período:']) || rowHasAll(row, ['Periodo:']))
}

function matchesC6Statement(rows: unknown[][]): boolean {
  return rows.slice(0, SEARCH_WINDOW).some(row => rowHasAll(row, ['Entrada(R$)', 'Saída(R$)']))
}

function matchesC6Invoice(rows: unknown[][]): boolean {
  return rows.slice(0, SEARCH_WINDOW).some(row => rowHasAll(row, ['Nome no Cartão', 'Valor (em R$)']))
}

export function detectTreasurySheetSource(sheets: SheetRows[], bankFolderName: string): TreasurySource | null {
  const bank = bankFolderName.trim().toLowerCase()

  for (const sheet of sheets) {
    if (bank === 'itau' && matchesItauStatement(sheet.rows)) return 'itau_statement'
    if (bank === 'c6' && matchesC6Invoice(sheet.rows)) return 'c6_invoice'
    if (bank === 'c6' && matchesC6Statement(sheet.rows)) return 'c6_statement'
  }

  return null
}
```

Check the invoice signature before the statement signature for `c6` (as written above) — confirm during this step, against the real headers in Step 5's test, that neither header accidentally satisfies the other's `rowHasAll` check; if the real C6 invoice header also happened to contain "Entrada(R$)"/"Saída(R$)" text this ordering would matter, but the two real headers read during this plan's own research share no column names, so ordering is not load-bearing here — keep it anyway as defensive style.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- detect-source.spec.ts`
Expected: PASS, 5/5.

- [ ] **Step 9: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/utils/
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): month-folder allowlist and content-based format detection for treasury Drive sync

Pure functions, tested against the real header text captured from the
actual Itaú/C6 files during this feature's own design research. Content
detection only — never by filename, matching how the existing Drive
source already distinguishes abastecimento from vendas-por-rede.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `itau-statement-sheet.parser.ts`

**Files:**
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/itau-statement-sheet.parser.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/itau-statement-sheet.parser.spec.ts`

**Interfaces:**
- Consumes: `TreasuryRawRow`, `TreasuryRawRejection` (`@app/treasury-ingestion-contracts`).
- Produces: `parseItauStatementSheet(rows: unknown[][]): { rows: TreasuryRawRow[]; rejections: TreasuryRawRejection[] }`, consumed by Task 9.

- [ ] **Step 1: Re-export and read the real file's transaction rows in full**

This design's own research read only the Itaú file's header block (Agência/Conta/Período, start of "Lançamentos") — not the transaction rows underneath it. Confirm the credential and re-fetch before writing a single line of parser code:

```bash
cd backend/apps/ingestion-worker-service
node -e "
const { auth, drive: createDrive } = require('@googleapis/drive');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createWriteStream } = require('fs'); const { pipeline } = require('stream/promises');
const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
const googleAuth = new auth.GoogleAuth({ credentials: JSON.parse(Buffer.from(b64, 'base64').toString('utf8')), scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
const drive = createDrive({ version: 'v3', auth: googleAuth });
async function main() {
  const list = async id => (await drive.files.list({ q: \`'\${id}' in parents and trashed = false\`, fields: 'files(id,name,mimeType)', supportsAllDrives: true, includeItemsFromAllDrives: true })).data.files;
  const months = await list('1m-79pKJqmE7nL9enlLb_ncAFHe7BBccq');
  const agosto = months.find(f => f.name.toLowerCase() === 'agosto');
  const banks = await list(agosto.id);
  const itauFiles = await list(banks.find(b => b.name === 'itau').id);
  const target = itauFiles.find(f => f.mimeType === 'application/vnd.google-apps.spreadsheet');
  const dest = path.join(os.tmpdir(), 'itau-full.xlsx');
  const res = await drive.files.export({ fileId: target.id, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'stream' });
  await pipeline(res.data, createWriteStream(dest));
  console.log('saved to', dest);
}
main();
"
```

Then read it: `node -e "require('./dist/apps/ingestion-worker-service/src/modules/ingestion/utils/read-workbook-rows').readWorkbookRows('<the dest path printed above>').then(s => console.log(JSON.stringify(s[0].rows.slice(0, 30))))"` (rebuild `dist` first with `pnpm run build` if the compiled reader is stale). Read at least 30 rows past the "Lançamentos" header to see the real transaction table's column headers and several real data rows — this determines the exact `columnIndex` lookups the parser below needs. Do not proceed to Step 2 until this real structure is in hand; the illustrative code in Step 3 names the columns this research is expected to find (Data, Lançamento/Descrição, Valor, Saldo — the same shape the PDF-based `itau.parser.ts` already extracts, per this feature's own design research) but the exact header text and column order must be confirmed against the real rows, the same discipline `row-mapping.ts`'s own header comment describes ("Por que colunas desconhecidas falham o arquivo").

- [ ] **Step 2: Write the failing tests against the real rows just read**

Build the fixture from the real rows read in Step 1 — replace the illustrative row values below with the actual ones once confirmed real (this step cannot be finalized before Step 1's real read; if the real column names differ from `Data`/`Lançamento`/`Valor` shown here, use the real ones):

```typescript
import { parseItauStatementSheet } from './itau-statement-sheet.parser'

describe('parseItauStatementSheet', () => {
  it('parses a real transaction row into a TreasuryRawRow', () => {
    const rows = [
      [null, null, null],
      ['Atualização:', '15/09/2026 09:39:30', null],
      ['Nome:', 'F&R SOLUCOES EXPERIENCE', null],
      ['Agência:', '2059', null],
      ['Conta:', '0099676-5', null],
      [null, null, null],
      ['Lançamentos', null, null],
      ['Periodo:', '01/08/2026 até 31/08/2026', null],
      // <replace with the real header row + at least 2 real data rows found in Step 1>
    ]
    const result = parseItauStatementSheet(rows)
    expect(result.rejections).toEqual([])
    expect(result.rows).toHaveLength(1) // adjust to the real fixture's row count
    // assert occurredOn/amountCents/direction/counterpartyRaw against the real row's real values
  })

  it('rejects a row whose date cannot be parsed rather than silently skipping it', () => {
    // build from the real header + one row with a corrupted date cell
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- itau-statement-sheet.parser.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement against the confirmed real layout**

Locate the "Lançamentos" header row the same way `locateRawHeaderRow` searches (a window, never an assumed position), find the real transaction-table header row beneath it, build a `columnIndex`, and map each subsequent row into a `TreasuryRawRow` using `parseBrDate`/`findMoneyInText` (`../../treasury-ingestion/utils/date.ts`, `.../money.ts` — reuse these existing utilities, do not reimplement Brazilian date/money parsing). A row whose date or amount cannot be parsed becomes a `TreasuryRawRejection`, never a dropped row. No `structuralHint` — Itaú's PDF parser does not set one either, per this design's own research into `structuralHint`'s intended, narrower use.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- itau-statement-sheet.parser.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/itau-statement-sheet.parser.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/itau-statement-sheet.parser.spec.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): Itaú statement sheet parser for treasury Drive sync

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `c6-statement-sheet.parser.ts`

**Files:**
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/c6-statement-sheet.parser.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/c6-statement-sheet.parser.spec.ts`

**Interfaces:**
- Consumes: `TreasuryRawRow`, `TreasuryRawRejection` (`@app/treasury-ingestion-contracts`).
- Produces: `parseC6StatementSheet(rows: unknown[][]): { rows: TreasuryRawRow[]; rejections: TreasuryRawRejection[] }`, consumed by Task 9.

The real header row is already fully known from this feature's own design research — no re-fetch needed:
`Data Lançamento, Data Contábil, Título, Descrição, Entrada(R$), Saída(R$), Tipo, Detalhe`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { parseC6StatementSheet } from './c6-statement-sheet.parser'

const HEADER = ['Data Lançamento', 'Data Contábil', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)', 'Tipo', 'Detalhe']

describe('parseC6StatementSheet', () => {
  it('parses an inflow row (Entrada populated, Saída empty/zero)', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 'Pix recebido de ALELO S.A.', 'Pix recebido de ALELO S.A.', 445.93, 0]]
    const result = parseC6StatementSheet(rows)
    expect(result.rejections).toEqual([])
    expect(result.rows).toEqual([{
      occurredOn: '2026-08-03',
      amountCents: 44593,
      direction: 'inflow',
      counterpartyRaw: 'Pix recebido de ALELO S.A.',
      sourceRef: 'row2',
    }])
  })

  it('parses an outflow row (Saída populated, Entrada empty/zero)', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 'DEBITO DE CARTAO ', 'REST FRANGOASSADO CAJ  CAJAMAR       BRA', 0, 36.69, 'Deslocamento', 'alimentação']]
    const result = parseC6StatementSheet(rows)
    expect(result.rows[0].direction).toBe('outflow')
    expect(result.rows[0].amountCents).toBe(3669)
    expect(result.rows[0].counterpartyRaw).toBe('REST FRANGOASSADO CAJ  CAJAMAR       BRA')
  })

  it('rejects a row with neither Entrada nor Saída populated', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 'Título', 'Descrição', 0, 0]]
    const result = parseC6StatementSheet(rows)
    expect(result.rows).toEqual([])
    expect(result.rejections).toHaveLength(1)
    expect(result.rejections[0].reason).toBe('no_amount')
  })

  it('rejects a row with an unparseable date rather than dropping it silently', () => {
    const rows = [HEADER, ['not-a-date', '2026-08-03T00:00:00.000Z', 'Título', 'Descrição', 10, 0]]
    const result = parseC6StatementSheet(rows)
    expect(result.rows).toEqual([])
    expect(result.rejections).toHaveLength(1)
    expect(result.rejections[0].reason).toBe('unparseable_date')
  })

  it('never sets structuralHint from the sheet\\'s own Tipo/Detalhe columns — that is the operator\\'s manual classification, not a structural fact', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 'SEGURO CONTA C6 Ago 26', 'Seguro Conta Ago 26', 0, 20, 'seguro conta', 'seguro']]
    const result = parseC6StatementSheet(rows)
    expect(result.rows[0].structuralHint).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- c6-statement-sheet.parser.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import type { ParseStatementLinesResult } from '../../treasury-ingestion/parsers/statement-line'
import { readRawColumn } from '../../ingestion/utils/row-mapping'

const HEADERS = ['Data Lançamento', 'Data Contábil', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)', 'Tipo', 'Detalhe']

function toColumnIndex(header: unknown[]): Record<string, number> {
  const index: Record<string, number> = {}
  header.forEach((cell, i) => {
    const key = String(cell ?? '').trim()
    if (key) index[key] = i
  })
  return index
}

function toDateOnly(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  return null
}

function toAmountCents(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export function parseC6StatementSheet(rows: unknown[][]): ParseStatementLinesResult {
  const [header, ...dataRows] = rows
  const columnIndex = toColumnIndex(header)
  const result: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []

  dataRows.forEach((row, i) => {
    const rowReference = `row${i + 2}`
    const occurredOn = toDateOnly(row[columnIndex['Data Lançamento']])
    if (!occurredOn) {
      rejections.push({ rowReference, reason: 'unparseable_date', detail: `"Data Lançamento" is not a recognisable date: ${JSON.stringify(row[columnIndex['Data Lançamento']])}` })
      return
    }

    const entrada = toAmountCents(row[columnIndex['Entrada(R$)']]) ?? 0
    const saida = toAmountCents(row[columnIndex['Saída(R$)']]) ?? 0

    if (entrada === 0 && saida === 0) {
      rejections.push({ rowReference, reason: 'no_amount', detail: 'Neither Entrada(R$) nor Saída(R$) is populated' })
      return
    }

    result.push({
      occurredOn,
      amountCents: entrada > 0 ? entrada : saida,
      direction: entrada > 0 ? 'inflow' : 'outflow',
      counterpartyRaw: String(row[columnIndex['Descrição']] ?? '').trim(),
      sourceRef: rowReference,
    })
  })

  return { rows: result, rejections }
}
```

Confirm `ParseStatementLinesResult`'s exact shape by reading `treasury-ingestion/parsers/statement-line.ts` in full before finalizing the import — this plan assumes it is `{ rows: TreasuryRawRow[]; rejections: TreasuryRawRejection[] }` based on `c6-statement.parser.ts`'s own return type read during this plan's research, but confirm rather than trust the summary.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- c6-statement-sheet.parser.spec.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/c6-statement-sheet.parser.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/c6-statement-sheet.parser.spec.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): C6 statement sheet parser for treasury Drive sync

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `c6-invoice-sheet.parser.ts`

**Files:**
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/c6-invoice-sheet.parser.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/c6-invoice-sheet.parser.spec.ts`

**Interfaces:**
- Consumes: `TreasuryRawRow`, `TreasuryRawRejection` (`@app/treasury-ingestion-contracts`).
- Produces: `parseC6InvoiceSheet(rows: unknown[][]): { rows: TreasuryRawRow[]; rejections: TreasuryRawRejection[] }`, consumed by Task 9.

Real header, already known: `Data de Compra, Nome no Cartão, Final do Cartão, Categoria, Descrição, Parcela, Valor (em US$), Cotação (em R$), Valor (em R$), Tipo, detalhe`. Real quirk already observed: one row's "Parcela" cell held a serialized date (`2026-06-05T00:00:00.000Z`) where every other row held plain text (`"Única"`) — an Excel auto-format artifact on a value that looked like a date.

- [ ] **Step 1: Write the failing tests**

```typescript
import { parseC6InvoiceSheet } from './c6-invoice-sheet.parser'

const HEADER = ['Data de Compra', 'Nome no Cartão', 'Final do Cartão', 'Categoria', 'Descrição', 'Parcela', 'Valor (em US$)', 'Cotação (em R$)', 'Valor (em R$)', 'Tipo', 'detalhe']

describe('parseC6InvoiceSheet', () => {
  it('parses a normal purchase row (Parcela as plain text)', () => {
    const rows = [HEADER, ['2026-08-09T00:00:00.000Z', 'BARBARA O F LTDA', 910, 'Empresa para empresa', 'SERV. NUVEM INTELBRAS', 'Única', 0, 0, 159.9, 'Operacional', 'camera']]
    const result = parseC6InvoiceSheet(rows)
    expect(result.rejections).toEqual([])
    expect(result.rows[0]).toEqual({
      occurredOn: '2026-08-09',
      amountCents: 15990,
      direction: 'outflow',
      counterpartyRaw: 'SERV. NUVEM INTELBRAS',
      sourceRef: 'row2',
    })
  })

  it('parses a negative Valor (em R$) as an inflow — a credit/payment line on the invoice', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', 'BARBARA O F LTDA', 910, '-', 'Inclusao de Pagamento    ', 'Única', 0, 0, -11978.85, 'cartão de crédito', 'cartão']]
    const result = parseC6InvoiceSheet(rows)
    expect(result.rows[0].direction).toBe('inflow')
    expect(result.rows[0].amountCents).toBe(1197885)
  })

  it('handles a Parcela cell holding a serialized date instead of plain text, without crashing or dropping the row', () => {
    const rows = [HEADER, ['2026-04-01T00:00:00.000Z', 'BARBARA O F LTDA', 910, 'Serviços de telecomunicações', 'PAGSEGUROINTERNET', '2026-06-05T00:00:00.000Z', 0, 0, 163.4, 'investimento', 'maquininha']]
    const result = parseC6InvoiceSheet(rows)
    expect(result.rejections).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].amountCents).toBe(16340)
  })

  it('handles a Descrição cell that is a hyperlink object instead of a plain string (real shape seen in the file)', () => {
    const rows = [HEADER, ['2026-07-29T00:00:00.000Z', 'BARBARA O F LTDA', 910, 'Entretenimento', { text: 'APPLE.COM/BILL', hyperlink: 'http://apple.com/BILL' }, 'Única', 0, 0, 20.5, 'Cloud apple', '']]
    const result = parseC6InvoiceSheet(rows)
    expect(result.rejections).toEqual([])
    expect(result.rows[0].counterpartyRaw).toBe('APPLE.COM/BILL')
  })

  it('never sets structuralHint from Tipo/detalhe', () => {
    const rows = [HEADER, ['2026-08-09T00:00:00.000Z', 'BARBARA O F LTDA', 910, 'Empresa para empresa', 'SERV. NUVEM INTELBRAS', 'Única', 0, 0, 159.9, 'Operacional', 'camera']]
    const result = parseC6InvoiceSheet(rows)
    expect(result.rows[0].structuralHint).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- c6-invoice-sheet.parser.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import type { ParseStatementLinesResult } from '../../treasury-ingestion/parsers/statement-line'

const HEADERS_INDEX = ['Data de Compra', 'Nome no Cartão', 'Final do Cartão', 'Categoria', 'Descrição', 'Parcela', 'Valor (em US$)', 'Cotação (em R$)', 'Valor (em R$)', 'Tipo', 'detalhe']

function toColumnIndex(header: unknown[]): Record<string, number> {
  const index: Record<string, number> = {}
  header.forEach((cell, i) => {
    const key = String(cell ?? '').trim()
    if (key) index[key] = i
  })
  return index
}

function toDateOnly(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  return null
}

/** A hyperlinked cell (ExcelJS reads it as {text, hyperlink}) reads as its visible text; a plain string passes through. */
function toText(value: unknown): string {
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text ?? '').trim()
  return String(value ?? '').trim()
}

export function parseC6InvoiceSheet(rows: unknown[][]): ParseStatementLinesResult {
  const [header, ...dataRows] = rows
  const columnIndex = toColumnIndex(header)
  const result: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []

  dataRows.forEach((row, i) => {
    const rowReference = `row${i + 2}`
    const occurredOn = toDateOnly(row[columnIndex['Data de Compra']])
    if (!occurredOn) {
      rejections.push({ rowReference, reason: 'unparseable_date', detail: `"Data de Compra" is not a recognisable date: ${JSON.stringify(row[columnIndex['Data de Compra']])}` })
      return
    }

    const valor = Number(row[columnIndex['Valor (em R$)']])
    if (!Number.isFinite(valor)) {
      rejections.push({ rowReference, reason: 'unparseable_amount', detail: `"Valor (em R$)" is not a number: ${JSON.stringify(row[columnIndex['Valor (em R$)']])}` })
      return
    }

    result.push({
      occurredOn,
      amountCents: Math.round(Math.abs(valor) * 100),
      // A negative Valor on an invoice is a credit/payment line (e.g. "Inclusao de Pagamento") — money reducing the balance owed, i.e. an inflow from the invoice's own perspective.
      direction: valor < 0 ? 'inflow' : 'outflow',
      counterpartyRaw: toText(row[columnIndex['Descrição']]),
      sourceRef: rowReference,
    })
  })

  return { rows: result, rejections }
}
```

Note: `Parcela` (`row[columnIndex['Parcela']]`) is read by neither this implementation nor the test assertions above — it is not part of `TreasuryRawRow` and the design's Non-goals explicitly exclude classification fields. The "handles a Parcela cell holding a serialized date" test exists to prove the ROW still parses correctly despite that cell's odd value, not to parse the cell itself; confirm this test passes with the implementation above making no reference to the `Parcela` column at all — if it doesn't, the fixture or the implementation has a real bug, not a missing feature.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- c6-invoice-sheet.parser.spec.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/c6-invoice-sheet.parser.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/parsers/c6-invoice-sheet.parser.spec.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): C6 invoice sheet parser for treasury Drive sync

Handles the real "Parcela" column's date-vs-text formatting quirk and a
hyperlinked Descrição cell, both observed in the real file.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `TreasuryDriveScanService` + scan worker

**Files:**
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive.repository.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive-scan.service.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/jobs/treasury-drive-scan.worker.ts`
- Test: `backend/apps/ingestion-worker-service/test/treasury-drive-scan.integration-spec.ts`

**Interfaces:**
- Consumes: `DriveClient` interface + `InMemoryDriveClient` (test) from `drive-source/services/drive-client.ts` / `drive-source/testing/in-memory-drive.client.ts` (imported, not modified); `readWorkbookRows`; `isAllowedMonthFolder`/`isRecognizedBankFolder`/`detectTreasurySheetSource` (Task 4); `TreasuryDriveConfig` (Task 2); `TreasuryDriveFile` Prisma model (Task 3).
- Produces: `TreasuryDriveRepository` (thin Prisma wrapper: `upsert`, `findById`, `list`), `TreasuryDriveScanService.scan(client: DriveClient, config: TreasuryDriveConfig): Promise<{ seen: number; new: number; changed: number }>`, consumed by Task 10's controller (via the worker) and Task 9 indirectly (shares the repository).

- [ ] **Step 1: Read `drive-scan.service.ts` in full for the scan-loop pattern**

Read `backend/apps/ingestion-worker-service/src/modules/drive-source/services/drive-scan.service.ts` in full — this is the closest structural precedent (list children, skip folders vs. files, compute a hash, upsert by Drive id), even though the depth and validation differ. Do not copy its coverage-validation calls.

- [ ] **Step 2: Write the failing integration test**

```typescript
import { InMemoryDriveClient } from '../src/modules/drive-source/testing/in-memory-drive.client'
import { TreasuryDriveScanService } from '../src/modules/treasury-drive-source/services/treasury-drive-scan.service'
import { TreasuryDriveRepository } from '../src/modules/treasury-drive-source/services/treasury-drive.repository'
import { withTestDb } from './support/with-test-db' // confirm the real helper name/path by reading an existing integration-spec that uses it, e.g. inventory-service or this service's own chunk-accumulation.integration-spec.ts

const C6_STATEMENT_HEADER_CSV = 'Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Tipo,Detalhe\n2026-08-03,2026-08-03,Pix recebido,Pix recebido de ALELO S.A.,445.93,0,,'
const ITAU_HEADER_CSV = 'Atualização:,15/09/2026,\nAgência:,2059,\nConta:,0099676-5,\nLançamentos,,\nPeriodo:,01/08/2026 até 31/08/2026,'

describe('TreasuryDriveScanService', () => {
  // withTestDb-style setup providing `prisma`

  it('tracks a new file under an allowlisted month/bank folder', async () => {
    const client = InMemoryDriveClient.fromTree('root', {
      agosto: { c6: { 'extrato c6 agosto': { sheet: C6_STATEMENT_HEADER_CSV } } },
    })
    const repo = new TreasuryDriveRepository(prisma)
    const service = new TreasuryDriveScanService(repo)

    const result = await service.scan(client, { enabled: true, rootFolderId: 'root', monthFolders: ['agosto'], scanCron: '0 6 * * *' } as any)

    expect(result.new).toBe(1)
    const files = await repo.list()
    expect(files[0]).toMatchObject({ month_folder_name: 'agosto', bank_folder_name: 'c6', detected_source: 'c6_statement', status: 'new' })
  })

  it('ignores a month folder not in the allowlist, even a real one (julho)', async () => {
    const client = InMemoryDriveClient.fromTree('root', {
      julho: { c6: { 'extrato c6 julho': { sheet: C6_STATEMENT_HEADER_CSV } } },
      agosto: { c6: { 'extrato c6 agosto': { sheet: C6_STATEMENT_HEADER_CSV } } },
    })
    const repo = new TreasuryDriveRepository(prisma)
    const service = new TreasuryDriveScanService(repo)

    await service.scan(client, { enabled: true, rootFolderId: 'root', monthFolders: ['agosto'], scanCron: '0 6 * * *' } as any)

    const files = await repo.list()
    expect(files).toHaveLength(1)
    expect(files[0].month_folder_name).toBe('agosto')
  })

  it('skips a subfolder inside a bank folder as noise (e.g. "comprovantes itau")', async () => {
    const client = InMemoryDriveClient.fromTree('root', {
      agosto: { itau: { 'comprovantes itau': { 'photo.jpg': 'not-a-spreadsheet' }, 'Entradas_Saidas': { sheet: ITAU_HEADER_CSV } } },
    })
    const repo = new TreasuryDriveRepository(prisma)
    const service = new TreasuryDriveScanService(repo)

    await service.scan(client, { enabled: true, rootFolderId: 'root', monthFolders: ['agosto'], scanCron: '0 6 * * *' } as any)

    const files = await repo.list()
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('Entradas_Saidas')
  })

  it('re-scanning an unchanged file does not flip it back to "new" once imported', async () => {
    const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: C6_STATEMENT_HEADER_CSV } } } })
    const repo = new TreasuryDriveRepository(prisma)
    const service = new TreasuryDriveScanService(repo)

    await service.scan(client, { enabled: true, rootFolderId: 'root', monthFolders: ['agosto'], scanCron: '0 6 * * *' } as any)
    const [first] = await repo.list()
    await repo.markImported(first.id, 1)

    await service.scan(client, { enabled: true, rootFolderId: 'root', monthFolders: ['agosto'], scanCron: '0 6 * * *' } as any)
    const [after] = await repo.list()
    expect(after.status).toBe('imported')
  })

  it('flips status to "changed" when the file content hash differs on a re-scan', async () => {
    const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: C6_STATEMENT_HEADER_CSV } } } })
    const repo = new TreasuryDriveRepository(prisma)
    const service = new TreasuryDriveScanService(repo)
    await service.scan(client, { enabled: true, rootFolderId: 'root', monthFolders: ['agosto'], scanCron: '0 6 * * *' } as any)
    const [first] = await repo.list()

    client.edit(first.drive_file_id, C6_STATEMENT_HEADER_CSV + '\n2026-08-04,2026-08-04,Novo,Novo,10,0,,')
    await service.scan(client, { enabled: true, rootFolderId: 'root', monthFolders: ['agosto'], scanCron: '0 6 * * *' } as any)

    const [after] = await repo.list()
    expect(after.status).toBe('changed')
  })
})
```

Confirm the real disposable-Postgres test helper's exact name/import path (`with-test-db.sh`/whatever TS wrapper calls it) by reading how an existing `*.integration-spec.ts` in this service sets up `prisma` before finalizing this test file — do not invent the helper's name.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend/apps/ingestion-worker-service && pnpm test:integration -- treasury-drive-scan.integration-spec.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 4: Implement `TreasuryDriveRepository`**

```typescript
import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { PrismaClientService } from '../../db-client/prisma-client.service'

@Injectable()
export class TreasuryDriveRepository {
  constructor(private readonly prisma: PrismaClientService) {}

  list() {
    return this.prisma.treasuryDriveFile.findMany({ orderBy: [{ month_folder_name: 'desc' }, { bank_folder_name: 'asc' }] })
  }

  findById(id: string) {
    return this.prisma.treasuryDriveFile.findUnique({ where: { id } })
  }

  async upsertSeen(input: {
    driveFileId: string
    monthFolderName: string
    bankFolderName: string
    detectedSource: string | null
    name: string
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
          modified_time: input.modifiedTime,
          content_sha256: input.contentSha256,
          status: 'new',
        },
      })
    }

    if (existing.content_sha256 === input.contentSha256) return existing
    // Only bump status for a genuine content change — an already-imported file never silently reverts to "new".
    if (existing.status === 'imported' || existing.status === 'importing') return existing

    return this.prisma.treasuryDriveFile.update({
      where: { id: existing.id },
      data: { content_sha256: input.contentSha256, modified_time: input.modifiedTime, detected_source: input.detectedSource, status: 'changed' },
    })
  }

  markImported(id: string, accountId: number) {
    return this.prisma.treasuryDriveFile.update({ where: { id }, data: { status: 'imported', imported_at: new Date(), imported_account_id: accountId } })
  }

  markImporting(id: string) {
    return this.prisma.treasuryDriveFile.update({ where: { id }, data: { status: 'importing' } })
  }

  markError(id: string, detail: string) {
    return this.prisma.treasuryDriveFile.update({ where: { id }, data: { status: 'error', error_detail: detail } })
  }
}
```

Re-check the "re-scanning an unchanged file" test against this `upsertSeen` logic: an `imported` file's own content hash is unchanged on a plain re-scan (same file, not edited), so it hits the `existing.content_sha256 === input.contentSha256` branch and returns early — the `status === 'imported'` guard below it exists specifically for the Task 8 test "flips status to changed on real edit" NOT reverting an imported-then-edited file back to "new"/"changed" carelessly; confirm both tests pass with this exact logic, adjusting if the two guards conflict in an untested combination.

- [ ] **Step 5: Implement `TreasuryDriveScanService`**

```typescript
import { Injectable, Logger } from '@nestjs/common'
import type { DriveClient } from '../../drive-source/services/drive-client'
import { readWorkbookRows } from '../../ingestion/utils/read-workbook-rows'
import { isAllowedMonthFolder, isRecognizedBankFolder } from '../utils/month-folder-allowlist'
import { detectTreasurySheetSource } from '../utils/detect-source'
import type { TreasuryDriveConfig } from '../config/treasury-drive.config'
import { TreasuryDriveRepository } from './treasury-drive.repository'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

@Injectable()
export class TreasuryDriveScanService {
  private readonly logger = new Logger(TreasuryDriveScanService.name)

  constructor(private readonly repository: TreasuryDriveRepository) {}

  async scan(client: DriveClient, config: TreasuryDriveConfig): Promise<{ seen: number; new: number; changed: number }> {
    if (!config.rootFolderId) return { seen: 0, new: 0, changed: 0 }

    let seen = 0, newCount = 0, changedCount = 0
    const tmp = mkdtempSync(join(tmpdir(), 'treasury-drive-scan-'))

    try {
      for await (const monthItem of client.listFolder(config.rootFolderId)) {
        if (!monthItem.isFolder || !isAllowedMonthFolder(monthItem.name, config.monthFolders)) continue

        for await (const bankItem of client.listFolder(monthItem.id)) {
          if (!bankItem.isFolder || !isRecognizedBankFolder(bankItem.name)) continue

          for await (const fileItem of client.listFolder(bankItem.id)) {
            if (fileItem.isFolder) continue // e.g. "comprovantes itau" — noise, never descended into

            seen++
            const destPath = join(tmp, fileItem.id)
            await client.exportSheet(fileItem.id, destPath, 25 * 1024 * 1024)
            const sheets = await readWorkbookRows(destPath)
            const detectedSource = detectTreasurySheetSource(sheets, bankItem.name)
            const contentSha256 = createHash('sha256').update(JSON.stringify(sheets)).digest('hex')

            const before = await this.repository.findById(fileItem.id)
            const result = await this.repository.upsertSeen({
              driveFileId: fileItem.id,
              monthFolderName: monthItem.name,
              bankFolderName: bankItem.name,
              detectedSource,
              name: fileItem.name,
              modifiedTime: new Date(fileItem.modifiedTime),
              contentSha256,
            })

            if (!before) newCount++
            else if (result.status === 'changed') changedCount++
          }
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }

    this.logger.log(`Treasury Drive scan: ${seen} file(s) seen, ${newCount} new, ${changedCount} changed`)
    return { seen, new: newCount, changed: changedCount }
  }
}
```

- [ ] **Step 6: Implement the scan worker (BullMQ consumer)**

Read `backend/apps/ingestion-worker-service/src/modules/drive-source/jobs/drive-scan.worker.ts` in full first, to match its exact `@Processor`/job-handling decorator pattern. Then:

```typescript
// treasury-drive-scan.worker.ts — mirrors drive-scan.worker.ts's structure:
// @Processor(TREASURY_DRIVE_QUEUES.SCAN) class consuming a job, building the
// real GoogleDriveClient from TREASURY_DRIVE_CONFIG, calling
// TreasuryDriveScanService.scan(client, config). Read the real
// drive-scan.worker.ts now and match its exact decorator/DI/error-handling
// shape rather than inventing one — this plan names the responsibility, the
// real file supplies the exact NestJS wiring convention this codebase uses.
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test:integration -- treasury-drive-scan.integration-spec.ts`
Expected: PASS, 5/5.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive.repository.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive-scan.service.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/jobs/treasury-drive-scan.worker.ts backend/apps/ingestion-worker-service/test/treasury-drive-scan.integration-spec.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): treasury Drive scan service and worker

Two-level folder scan (month -> bank -> file), content-based detection,
new/changed tracking that never reverts an already-imported file.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `TreasuryDriveImportService` + import worker

**Files:**
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive-import.service.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/jobs/treasury-drive-import.worker.ts`
- Test: `backend/apps/ingestion-worker-service/test/treasury-drive-import.integration-spec.ts`

**Interfaces:**
- Consumes: `TreasuryDriveRepository` (Task 8), the 3 parsers (Tasks 5–7), `S3Service` (`@app/aws`), `HoldItBullMQBroker` (`@app/hold-it`), `TREASURY_QUEUES`/`TreasuryRawRowsJob` (`@app/treasury-ingestion-contracts`).
- Produces: `TreasuryDriveImportService.import(id: string, accountId: number, period: string): Promise<{ status: 'imported'; jobId: string }>`, consumed by Task 10's controller (via the worker).

- [ ] **Step 1: Read `drive-import.service.ts` in full for the re-check-everything pattern**

Read `backend/apps/ingestion-worker-service/src/modules/drive-source/services/drive-import.service.ts` in full — confirms the exact "never trust the scan's cached read" pattern (re-download, re-validate, then act) this task must follow, and the `S3Service` upload call shape to reuse.

- [ ] **Step 2: Write the failing integration test**

```typescript
import { InMemoryDriveClient } from '../src/modules/drive-source/testing/in-memory-drive.client'
import { TreasuryDriveImportService } from '../src/modules/treasury-drive-source/services/treasury-drive-import.service'
import { TreasuryDriveRepository } from '../src/modules/treasury-drive-source/services/treasury-drive.repository'
// stub HoldItBullMQBroker and S3Service the same way drive-import's own integration spec does — read that file's setup before writing this one

const C6_STATEMENT_CSV = 'Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Tipo,Detalhe\n2026-08-03,2026-08-03,Pix,Pix recebido,445.93,0,,'

describe('TreasuryDriveImportService', () => {
  it('publishes a TreasuryRawRowsJob with the confirmed accountId/period and the file\\'s real modifiedTime, not the import run\\'s own clock', async () => {
    const client = InMemoryDriveClient.fromTree('root', { agosto: { c6: { 'extrato c6 agosto': { sheet: C6_STATEMENT_CSV } } } })
    const repo = new TreasuryDriveRepository(prisma)
    // scan first so a tracked row exists (Task 8's service), or seed the row directly via repo.upsertSeen

    const service = new TreasuryDriveImportService(repo, brokerStub, s3Stub)
    const result = await service.import(trackedFile.id, client, 42, '2026-08')

    expect(result.status).toBe('imported')
    expect(brokerStub.published).toHaveLength(1)
    expect(brokerStub.published[0].queueName).toBe('treasury.raw-rows')
    expect(brokerStub.published[0].message.accountId).toBe(42)
    expect(brokerStub.published[0].message.period).toBe('2026-08')
    expect(brokerStub.published[0].message.source).toBe('c6_statement')
    expect(brokerStub.published[0].message.rows).toHaveLength(1)
  })

  it('refuses a second import of the same already-imported file', async () => {
    // import once, then attempt again; expect a thrown/refused result naming the reason, and only ONE job ever published
  })

  it('marks the file "error" and does not publish anything when the re-fetched content no longer matches any known signature', async () => {
    // edit the file in the InMemoryDriveClient to unrelated content between scan and import, then import
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend/apps/ingestion-worker-service && pnpm test:integration -- treasury-drive-import.integration-spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement**

```typescript
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HoldItBullMQBroker } from '@app/hold-it'
import { TREASURY_QUEUES, type TreasuryRawRowsJob } from '@app/treasury-ingestion-contracts'
import type { DriveClient } from '../../drive-source/services/drive-client'
import { readWorkbookRows } from '../../ingestion/utils/read-workbook-rows'
import { detectTreasurySheetSource } from '../utils/detect-source'
import { parseItauStatementSheet } from '../parsers/itau-statement-sheet.parser'
import { parseC6StatementSheet } from '../parsers/c6-statement-sheet.parser'
import { parseC6InvoiceSheet } from '../parsers/c6-invoice-sheet.parser'
import { TreasuryDriveRepository } from './treasury-drive.repository'
// import S3Service from '@app/aws' — confirm the exact upload method signature by reading drive-import.service.ts's own S3 call before finalizing

const PARSERS = {
  itau_statement: parseItauStatementSheet,
  c6_statement: parseC6StatementSheet,
  c6_invoice: parseC6InvoiceSheet,
} as const

@Injectable()
export class TreasuryDriveImportService {
  constructor(
    private readonly repository: TreasuryDriveRepository,
    private readonly broker: HoldItBullMQBroker,
    // private readonly s3: S3Service,
  ) {}

  async import(id: string, client: DriveClient, accountId: number, period: string) {
    const file = await this.repository.findById(id)
    if (!file) throw new BadRequestException({ code: 'not_found' })
    if (file.status === 'imported') throw new ConflictException({ code: 'already_imported' })

    await this.repository.markImporting(id)

    try {
      const tmp = mkdtempSync(join(tmpdir(), 'treasury-drive-import-'))
      const destPath = join(tmp, file.drive_file_id)

      try {
        await client.exportSheet(file.drive_file_id, destPath, 25 * 1024 * 1024)
        const sheets = await readWorkbookRows(destPath)
        const detectedSource = detectTreasurySheetSource(sheets, file.bank_folder_name)

        if (!detectedSource) {
          await this.repository.markError(id, 'Re-check at import time found no recognizable signature')
          throw new BadRequestException({ code: 'unrecognized' })
        }

        const parse = PARSERS[detectedSource as keyof typeof PARSERS]
        const { rows, rejections } = parse(sheets[0].rows)

        // objectKey = await this.s3.upload(...) — confirm real method/args from drive-import.service.ts

        const job: TreasuryRawRowsJob = {
          schemaVersion: 1,
          source: detectedSource,
          accountId,
          period,
          objectKey: 'PLACEHOLDER — replace with the real S3Service upload call\\'s return value, confirmed in Step 4 against drive-import.service.ts',
          rows,
          rejections,
        }

        await this.broker.holdIt({ queueName: TREASURY_QUEUES.RAW_ROWS, message: job, options: { attempts: 1 } })
        await this.repository.markImported(id, accountId)

        return { status: 'imported' as const }
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    } catch (error) {
      if (!(error instanceof BadRequestException) && !(error instanceof ConflictException)) {
        await this.repository.markError(id, (error as Error).message)
      }
      throw error
    }
  }
}
```

The `objectKey` placeholder above must be replaced with a real `S3Service` upload call before this step is done — re-read `drive-import.service.ts`'s own upload call (bucket, key convention, content type) during this step and use the same pattern; a job published with a placeholder `objectKey` is not a passing implementation of this task, and the test in Step 2 should assert `objectKey` is a real, non-placeholder string once this is fixed.

- [ ] **Step 5: Implement the import worker (BullMQ consumer)**

Same approach as Task 8 Step 6: read `drive-import.worker.ts` in full, mirror its exact decorator/DI shape, calling `TreasuryDriveImportService.import(...)`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test:integration -- treasury-drive-import.integration-spec.ts`
Expected: PASS, 3/3.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive-import.service.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/jobs/treasury-drive-import.worker.ts backend/apps/ingestion-worker-service/test/treasury-drive-import.integration-spec.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): treasury Drive import service and worker

Re-downloads and re-detects fresh at import time — never trusts the
scan's cached read for the actual write, same principle drive-source's
own import already follows. Publishes to the existing treasury.raw-rows
queue unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `treasury-drive-files.controller.ts`, DTOs, producer, module wiring

**Files:**
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/dto/treasury-drive-files.dto.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive.producer.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/controllers/treasury-drive-files.controller.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/treasury-drive-source.module.ts`
- Modify: `backend/apps/ingestion-worker-service/src/app.module.ts`
- Test: `backend/apps/ingestion-worker-service/test/treasury-drive-files.integration-spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–9.
- Produces: `GET /treasury-drive-files`, `GET /treasury-drive-files/status`, `POST /treasury-drive-files/scan`, `POST /treasury-drive-files/:id/import`, `POST /treasury-drive-files/:id/ignore` — consumed by Task 12's gateway proxy.

- [ ] **Step 1: Read `drive-files.dto.ts` and `drive.producer.ts` in full for the exact DTO/producer conventions**

Already read `drive-files.controller.ts` and `drive.producer.ts` during this plan's own research (above) — re-read `drive-files.dto.ts` now for the exact `class-validator` DTO shape to mirror.

- [ ] **Step 2: Write the failing integration test**

```typescript
// treasury-drive-files.integration-spec.ts — supertest against the real app + InMemoryDriveClient,
// mirroring gateway.integration-spec.ts's own style for a whole-controller test:
// - GET /treasury-drive-files/status returns {configured: false} when env vars are unset
// - POST /treasury-drive-files/scan returns 202 and queues a scan
// - POST /treasury-drive-files/:id/import with {accountId, period} returns 202 (or the
//   import's own status, matching whatever the Step 4 controller settles on — see the
//   drive-files.controller.ts precedent: import is queued OR synchronous depending on
//   whether validation already ran; here import IS synchronous — Task 9's service runs
//   inline, not via a queued worker's async completion the caller waits on separately)
// - POST /treasury-drive-files/:id/import on an unknown id returns 404
```

Confirm during this step whether `import` should answer 202 (queued, matching the sales/abastecimento pattern exactly) or run synchronously and answer once done — re-read the spec's own Architecture section: it says the import worker consumes a queue job, so `POST /:id/import` should enqueue via the producer and answer 202, same as sales/abastecimento, with `TreasuryDriveImportService.import` running inside the worker (Task 9's job), not inline in the controller. Adjust the controller/test to match this — the controller enqueues, the worker (Task 9) does the work.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend/apps/ingestion-worker-service && pnpm test:integration -- treasury-drive-files.integration-spec.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the DTOs, producer, controller, module**

```typescript
// dto/treasury-drive-files.dto.ts
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator'

export class ImportTreasuryDriveFileDto {
  @IsInt() @Min(1)
  accountId: number

  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  period: string
}

export class IgnoreTreasuryDriveFileDto {
  @IsOptional() @IsBoolean()
  ignored?: boolean
}
```

```typescript
// services/treasury-drive.producer.ts — mirrors DriveProducer's enqueueScan
// (dedup on waiting/active, never a fixed jobId) and enqueueImport (jobId per
// file+timestamp) exactly, targeting TREASURY_DRIVE_QUEUES instead of
// DRIVE_QUEUES. Re-read DriveProducer (already read in full above) and copy
// its de-duplication reasoning verbatim in the new file's own comments —
// the same hold-it retention gotcha applies here unchanged.
```

```typescript
// controllers/treasury-drive-files.controller.ts — mirrors DriveFilesController's
// shape: @Controller('treasury-drive-files'), a not-configured 409 guard reading
// TREASURY_DRIVE_CONFIG, GET list/status, POST scan (202), POST :id/import (202,
// body validated by ImportTreasuryDriveFileDto), POST :id/ignore. No :id/validate
// route — this module has no separate async validation step (see spec).
```

```typescript
// treasury-drive-source.module.ts — providers: TreasuryDriveRepository,
// TreasuryDriveScanService, TreasuryDriveImportService, TreasuryDriveProducer,
// the scheduler (Task 11), the two job workers; controllers: TreasuryDriveFilesController;
// { provide: TREASURY_DRIVE_CONFIG, useFactory: () => loadTreasuryDriveConfig(process.env) }.
```

Register the new module in `app.module.ts`'s `imports` array alongside `DriveSourceModule`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test:integration -- treasury-drive-files.integration-spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/dto/ backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive.producer.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/controllers/ backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/treasury-drive-source.module.ts backend/apps/ingestion-worker-service/src/app.module.ts backend/apps/ingestion-worker-service/test/treasury-drive-files.integration-spec.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): treasury Drive files controller, DTOs and module wiring

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Register queues and the scan scheduler

**Files:**
- Create: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive-scheduler.service.ts`
- Modify: `backend/apps/ingestion-worker-service/src/registered-queues.ts`
- Modify: `backend/apps/ingestion-worker-service/src/registered-queues.spec.ts`
- Modify: `backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/treasury-drive-source.module.ts` (register the scheduler as a provider)

**Interfaces:**
- Consumes: `TREASURY_DRIVE_QUEUES` (Task 2), `TreasuryDriveConfig`/`TREASURY_DRIVE_CONFIG` (Task 2), `HoldItBullMQBroker`.
- Produces: nothing new for later tasks — this is the piece that makes the queues actually resolvable and the 06:00 scan actually fire.

- [ ] **Step 1: Write the failing test for `REGISTERED_QUEUES`**

Add to `registered-queues.spec.ts`:

```typescript
import { TREASURY_DRIVE_QUEUES } from './modules/treasury-drive-source/constants/treasury-drive.constants'

it('includes the internal treasury Drive queues — scan and import are published with holdIt', () => {
  for (const queueName of Object.values(TREASURY_DRIVE_QUEUES)) {
    expect(REGISTERED_QUEUES).toContain(queueName)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- registered-queues.spec.ts`
Expected: FAIL — `TREASURY_DRIVE_QUEUES` values not in `REGISTERED_QUEUES`.

- [ ] **Step 3: Register the queues**

In `registered-queues.ts`, add the import and extend the array:

```typescript
import { TREASURY_DRIVE_QUEUES } from './modules/treasury-drive-source/constants/treasury-drive.constants'

// ... inside the array, near the DRIVE_QUEUES spread:
...Object.values(TREASURY_DRIVE_QUEUES),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- registered-queues.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the scheduler, mirroring `drive-scheduler.service.ts` exactly**

```typescript
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { TREASURY_DRIVE_CONFIG, type TreasuryDriveConfig } from '../config/treasury-drive.config'
import { TREASURY_DRIVE_QUEUES, TREASURY_DRIVE_SCHEDULER_ID, TREASURY_DRIVE_TIME_ZONE } from '../constants/treasury-drive.constants'

@Injectable()
export class TreasuryDriveSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TreasuryDriveSchedulerService.name)

  constructor(
    @Inject(TREASURY_DRIVE_CONFIG) private readonly config: TreasuryDriveConfig,
    private readonly broker: HoldItBullMQBroker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const queue = await this.broker.getQueue(TREASURY_DRIVE_QUEUES.SCAN)

      if (this.config.enabled) {
        await queue.upsertJobScheduler(
          TREASURY_DRIVE_SCHEDULER_ID,
          { pattern: this.config.scanCron, tz: TREASURY_DRIVE_TIME_ZONE },
          { name: TREASURY_DRIVE_QUEUES.SCAN, data: {}, opts: { attempts: 1, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } } },
        )
        this.logger.log(`Treasury Drive scan scheduled: "${this.config.scanCron}" (${TREASURY_DRIVE_TIME_ZONE})`)
      } else {
        await queue.removeJobScheduler(TREASURY_DRIVE_SCHEDULER_ID)
      }
    } catch (error) {
      this.logger.error(`Could not update the treasury Drive scan schedule: ${(error as Error).message}`)
    }
  }
}
```

Register it as a provider in `treasury-drive-source.module.ts`.

- [ ] **Step 6: Run the whole service's test suite**

Run: `cd backend/apps/ingestion-worker-service && pnpm test && pnpm test:integration`
Expected: PASS, all green.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/registered-queues.ts backend/apps/ingestion-worker-service/src/registered-queues.spec.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/services/treasury-drive-scheduler.service.ts backend/apps/ingestion-worker-service/src/modules/treasury-drive-source/treasury-drive-source.module.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): register treasury Drive queues and 06:00 scan scheduler

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Gateway proxy routes

**Files:**
- Modify: `backend/apps/gateway-service/src/modules/domains/controllers/treasury.controller.ts` (or create a small dedicated file if treasury's existing gateway controller doesn't already group naturally — confirm in Step 1)
- Test: `backend/apps/gateway-service/test/gateway.integration-spec.ts` (existing file — extend)

**Interfaces:**
- Consumes: Task 10's 5 routes.
- Produces: the same 5 routes, reachable through the gateway, consumed by Task 13's frontend API layer.

- [ ] **Step 1: Read the gateway's existing treasury controller and its `INGESTION_SERVICE_URL`-based forwarding pattern**

Confirm the exact existing file path and forwarding pattern (`this.domains.X({method, path, payload, correlationId})`, returning `result.data`) by reading whichever gateway controller currently proxies `/treasury/*` routes, and confirm `INGESTION_SERVICE_URL` (already configured, since `/drive-files` already proxies through it) is the same target for these new routes.

- [ ] **Step 2: Write the failing tests, matching `gateway.integration-spec.ts`'s established permission-gate style (Task 3's own precedent from the restock-mix plan, read for its exact "authorization" describe-block pattern)**

```typescript
// Following the existing "authorization" block's pattern exactly: for each of
// the 5 new routes, one 403-when-missing-permission test and one 200/202-when-
// granted-and-forwarded test (asserting the UpstreamStub recorded the right
// METHOD + path, per that block's own established depth — never asserting
// the payload body, matching every other route in that same describe block).
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend/apps/gateway-service && pnpm test:integration -- gateway.integration-spec.ts`
Expected: FAIL.

- [ ] **Step 4: Add the 5 proxy routes**

```typescript
@Get('treasury-drive-files')
@RequiresPermission('treasury:read')
async listTreasuryDriveFiles() {
  const result = await this.domains.ingestion({ method: 'GET', path: '/treasury-drive-files' })
  return result.data
}

@Get('treasury-drive-files/status')
@RequiresPermission('treasury:read')
async treasuryDriveFilesStatus() {
  const result = await this.domains.ingestion({ method: 'GET', path: '/treasury-drive-files/status' })
  return result.data
}

@Post('treasury-drive-files/scan')
@RequiresPermission('treasury:write')
async scanTreasuryDriveFiles(@Headers('x-correlation-id') correlationId?: string) {
  const result = await this.domains.ingestion({ method: 'POST', path: '/treasury-drive-files/scan', correlationId })
  return result.data
}

@Post('treasury-drive-files/:id/import')
@RequiresPermission('treasury:write')
async importTreasuryDriveFile(@Param('id') id: string, @Body() body: unknown, @Headers('x-correlation-id') correlationId?: string) {
  const result = await this.domains.ingestion({ method: 'POST', path: `/treasury-drive-files/${encodeURIComponent(id)}/import`, payload: body, correlationId })
  return result.data
}

@Post('treasury-drive-files/:id/ignore')
@RequiresPermission('treasury:write')
async ignoreTreasuryDriveFile(@Param('id') id: string, @Body() body: unknown) {
  const result = await this.domains.ingestion({ method: 'POST', path: `/treasury-drive-files/${encodeURIComponent(id)}/ignore`, payload: body })
  return result.data
}
```

Confirm the exact method name on `this.domains` (`ingestion` above is this plan's best guess, matching that `drive-files` already proxies through the ingestion-worker domain — confirm against the real file read in Step 1) and the exact `@RequiresPermission` decorator import path before finalizing — this plan names the real permission strings (`treasury:read`/`treasury:write`, already used by the existing manual-upload treasury routes) but the call shape must match the file actually read.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend/apps/gateway-service && pnpm test:integration -- gateway.integration-spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/gateway-service/src/modules/domains/controllers/
git commit -m "$(cat <<'EOF'
feat(gateway): proxy treasury Drive files routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Admin frontend — API layer

**Files:**
- Modify: `frontend/apps/admin/src/lib/api/treasury.ts`

**Interfaces:**
- Consumes: Task 12's 5 gateway routes; `TreasurySource`/`TREASURY_SOURCE_LABELS`/`BankAccount` (already exported from this same file).
- Produces: `useGetTreasuryDriveFilesQuery`, `useGetTreasuryDriveStatusQuery`, `useScanTreasuryDriveMutation`, `useImportTreasuryDriveFileMutation`, `useIgnoreTreasuryDriveFileMutation`, consumed by Task 14.

- [ ] **Step 1: Read the file in full, and re-read `lib/api/ingestion.ts`'s Drive section (already read during this plan's research) as the pattern to mirror**

Read `frontend/apps/admin/src/lib/api/treasury.ts` in full (confirm current line count and exact tag list before editing) — the new endpoints join the same `createApi` instance, not a new one, since they operate on treasury data and should invalidate the same `PendingImport`-related tags where relevant.

- [ ] **Step 2: Add the types and endpoints**

```typescript
export type TreasuryDriveFileStatus = "new" | "changed" | "importing" | "imported" | "ignored" | "error";

export interface TreasuryDriveFile {
  id: string;
  month_folder_name: string;
  bank_folder_name: string;
  detected_source: TreasurySource | null;
  name: string;
  modified_time: string;
  status: TreasuryDriveFileStatus;
  imported_at: string | null;
  imported_account_id: number | null;
  error_detail: string | null;
}

export interface TreasuryDriveStatus {
  configured: boolean;
}

export interface ImportTreasuryDriveFileArgs {
  id: string;
  accountId: number;
  period: string;
}

// ... inside createApi's endpoints, alongside the existing ones:
getTreasuryDriveFiles: builder.query<TreasuryDriveFile[], void>({
  query: () => "/treasury-drive-files",
  providesTags: ["TreasuryDriveFile"],
}),
getTreasuryDriveStatus: builder.query<TreasuryDriveStatus, void>({
  query: () => "/treasury-drive-files/status",
  providesTags: ["TreasuryDriveStatus"],
}),
scanTreasuryDrive: builder.mutation<{ status: "queued" | "already_running" }, void>({
  query: () => ({ url: "/treasury-drive-files/scan", method: "POST" }),
  invalidatesTags: ["TreasuryDriveStatus"],
}),
importTreasuryDriveFile: builder.mutation<{ status: string }, ImportTreasuryDriveFileArgs>({
  query: ({ id, ...body }) => ({ url: `/treasury-drive-files/${encodeURIComponent(id)}/import`, method: "POST", body }),
  invalidatesTags: ["TreasuryDriveFile", "PendingImport"],
}),
ignoreTreasuryDriveFile: builder.mutation<{ status: string }, { id: string; ignored: boolean }>({
  query: ({ id, ignored }) => ({ url: `/treasury-drive-files/${encodeURIComponent(id)}/ignore`, method: "POST", body: { ignored } }),
  invalidatesTags: ["TreasuryDriveFile"],
}),
```

Add `"TreasuryDriveFile"` and `"TreasuryDriveStatus"` to the `tagTypes` array; confirm `"PendingImport"` is already a real tag in this file (it should be, given `PendingImport` is already queried here) before invalidating it — if the real tag name differs, use the real one.

- [ ] **Step 3: Export the new hooks**

Add `useGetTreasuryDriveFilesQuery`, `useGetTreasuryDriveStatusQuery`, `useScanTreasuryDriveMutation`, `useImportTreasuryDriveFileMutation`, `useIgnoreTreasuryDriveFileMutation` to the file's export block.

- [ ] **Step 4: Typecheck**

Run: `cd frontend/apps/admin && pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/apps/admin/src/lib/api/treasury.ts
git commit -m "$(cat <<'EOF'
feat(admin): RTK Query endpoints for treasury Drive files

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Admin frontend — "Arquivos no Drive" section on `/treasury/imports`

**Files:**
- Create: `frontend/apps/admin/src/components/treasury/drive-files-section.tsx`
- Create: `frontend/apps/admin/src/components/treasury/drive-files-section.spec.tsx`
- Create: `frontend/apps/admin/src/components/treasury/drive-file-row.tsx`
- Create: `frontend/apps/admin/src/components/treasury/drive-import-dialog.tsx`
- Create: `frontend/apps/admin/src/components/treasury/drive-import-dialog.spec.tsx`
- Modify: `frontend/apps/admin/src/app/(app)/treasury/imports/page.tsx`

**Interfaces:**
- Consumes: Task 13's hooks; `useGetAccountsQuery`/`BankAccount`/`TREASURY_SOURCE_LABELS` (already exported from `lib/api/treasury.ts`); `useHasPermission` (`lib/auth/use-permission.ts`).
- Produces: nothing for later tasks — leaf UI task.

- [ ] **Step 1: Read `drive-files-section.tsx`, `drive-file-row.tsx`, and `drive-import-dialog.tsx` in full, and read the current `/treasury/imports/page.tsx` in full**

Already read `drive-files-section.tsx`'s header during this plan's research; read the rest, plus its two sibling components, in full now — this task adapts their structure (not their sales-specific validation UI, which this feature has none of) to treasury. Read `/treasury/imports/page.tsx` in full to find exactly where "above the existing manual-upload history table" means in the real JSX.

- [ ] **Step 2: Write the failing test for the section's core behavior**

```typescript
import { describe, it, expect, jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import { DriveFilesSection } from "./drive-files-section";
import type { TreasuryDriveFile } from "@/lib/api/treasury";

// Mock useGetTreasuryDriveFilesQuery/useGetTreasuryDriveStatusQuery/useScanTreasuryDriveMutation
// the same jest.doMock + dynamic require pattern this codebase's own products
// page.spec.tsx already established (this SWC-based Jest transform does not
// hoist jest.mock() above static imports) — read that file's exact pattern
// before writing this one's mocks, do not reinvent a lighter version that
// silently doesn't intercept the real module.

const FILES: TreasuryDriveFile[] = [
  { id: "f1", month_folder_name: "agosto", bank_folder_name: "c6", detected_source: "c6_statement", name: "extrato c6 agosto", modified_time: "2026-09-15T00:00:00.000Z", status: "new", imported_at: null, imported_account_id: null, error_detail: null },
];

describe("DriveFilesSection", () => {
  it("shows each tracked file with its bank, detected type and status", () => {
    // render with mocked query returning FILES; assert "c6" and "Extrato C6" (TREASURY_SOURCE_LABELS) both appear
  });

  it("shows 'não reconhecido' for a file with detected_source: null, never a fabricated type", () => {
    // FILES with detected_source: null; assert "não reconhecido" text, no Importar button enabled for it
  });

  it("clicking Sincronizar agora calls the scan mutation", () => {
    // fireEvent.click the sync button; assert the mocked mutation trigger was called
  });

  it("clicking Importar opens the confirmation dialog, never imports directly", () => {
    // fireEvent.click Importar on a recognized file; assert the dialog/account dropdown appears, assert the import mutation was NOT yet called
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend/apps/admin && pnpm exec jest drive-files-section.spec.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `DriveFileRow`, `DriveImportDialog`, `DriveFilesSection`**

`DriveImportDialog` shows the file's `bank_folder_name`/`detected_source`, a `BankAccount` dropdown (from `useGetAccountsQuery`) pre-selected by matching `bank_folder_name` against `BankAccount.institution` (case-insensitively; confirm the real institution values `useGetAccountsQuery` returns match "itau"/"c6" during this step — if they differ, e.g. "Itaú" vs "itau", normalize before matching, never silently fail to pre-select), a period input pre-filled from `modified_time` (formatted `YYYY-MM`), and Confirmar/Cancelar — mirroring `ResourceFormDialog`'s established shadcn Dialog pattern for the shell, not its generic field-list API (this dialog's fields are specific enough to hand-write, matching `drive-import-dialog.tsx`'s own existing precedent for a confirmation dialog in this exact codebase).

`DriveFilesSection` follows `drive-files-section.tsx`'s polling-and-status pattern for the "Sincronizar agora" button and status display, but with no validation-report UI at all (there is none to show) — a `DriveFileRow` per tracked file: bank, detected type (label via `TREASURY_SOURCE_LABELS[detected_source]`, or "não reconhecido" when null), status, an "Importar" button (disabled when `detected_source` is null) opening `DriveImportDialog`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend/apps/admin && pnpm exec jest drive-files-section.spec.tsx drive-import-dialog.spec.tsx`
Expected: PASS.

- [ ] **Step 6: Mount the section on `/treasury/imports`**

Add `<DriveFilesSection />` above the existing manual-import history table in `page.tsx`, matching the real JSX structure read in Step 1.

- [ ] **Step 7: Typecheck and run the whole frontend suite**

Run: `cd frontend/apps/admin && pnpm exec tsc --noEmit && pnpm exec jest`
Expected: clean typecheck; full suite green (existing count plus this task's new tests).

- [ ] **Step 8: Commit**

```bash
git add frontend/apps/admin/src/components/treasury/ "frontend/apps/admin/src/app/(app)/treasury/imports/page.tsx"
git commit -m "$(cat <<'EOF'
feat(admin): "Arquivos no Drive" section on the Importar extratos screen

Same review-then-confirm-then-import experience sales/abastecimento's
Drive section already has, scoped to treasury: no coverage validation
UI (none applies to a whole-month statement), account+period confirmed
by the operator before any write.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Docker and env wiring

**Files:**
- Modify: `backend/apps/ingestion-worker-service/docker-compose.yml`
- Modify: `.env.example` (repo root)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing for later tasks — deployment config only.

- [ ] **Step 1: Read the current `docker-compose.yml`'s existing `GOOGLE_DRIVE_ROOT_FOLDER_ID`/`GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` block in full**

Confirm the exact `environment:` block shape (`${VAR:-default}` substitution style) already used for the existing Drive vars.

- [ ] **Step 2: Add the two new env vars alongside them**

```yaml
      TREASURY_DRIVE_ROOT_FOLDER_ID: ${TREASURY_DRIVE_ROOT_FOLDER_ID:-}
      TREASURY_DRIVE_MONTH_FOLDERS: ${TREASURY_DRIVE_MONTH_FOLDERS:-}
      TREASURY_DRIVE_SCAN_CRON: ${TREASURY_DRIVE_SCAN_CRON:-}
```

- [ ] **Step 3: Document them in `.env.example`**

Add the same 3 variables, commented, next to the existing `GOOGLE_DRIVE_ROOT_FOLDER_ID` documentation block, noting they reuse the same `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` credential and describing `TREASURY_DRIVE_MONTH_FOLDERS`'s comma-separated, manually-extended-each-month convention in one line.

- [ ] **Step 4: Commit**

```bash
git add backend/apps/ingestion-worker-service/docker-compose.yml .env.example
git commit -m "$(cat <<'EOF'
chore(ingestion-worker): wire treasury Drive env vars in compose and .env.example

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Documentation

**Files:**
- Modify: `backend/apps/ingestion-worker-service/CLAUDE.md`
- Modify: `frontend/apps/admin/CLAUDE.md`

**Interfaces:**
- Consumes: the finished state of Tasks 1–15.
- Produces: nothing for later tasks.

- [ ] **Step 1: Add a section to `ingestion-worker-service/CLAUDE.md`**

After the existing "A fonte Drive" section, add a short "A fonte Drive de tesouraria" subsection: the second root folder, the month/bank allowlist convention (and why it's a manual list, not computed — year ambiguity), the 3 sources this phase covers, that it feeds the exact same `treasury.raw-rows` queue untouched, and the explicit non-goal of reusing the operator's own Tipo/Detalhe classification. Cross-reference the design spec and this plan by path.

- [ ] **Step 2: Add a note to `frontend/apps/admin/CLAUDE.md`'s treasury section**

One paragraph under wherever `/treasury/imports` is documented: the new "Arquivos no Drive" section exists, mirrors `/ingestion`'s pattern, scoped to Itaú/C6 for now.

- [ ] **Step 3: Commit**

```bash
git add backend/apps/ingestion-worker-service/CLAUDE.md frontend/apps/admin/CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document treasury statement Drive sync

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17 (manual, not a fresh-subagent task): real acceptance against the real Drive folder

Same principle as this codebase's own established precedent for a feature's first real run (e.g. the restock-mix plan's own Task 18): **not** part of the automated task loop. Requires the real `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`/`TREASURY_DRIVE_ROOT_FOLDER_ID`/`TREASURY_DRIVE_MONTH_FOLDERS=agosto,setembro` set, the service rebuilt and restarted, and the operator watching the real `/treasury/imports` screen.

**Steps:**
1. Set the 3 env vars for real, restart `ingestion-dev`.
2. Confirm `GET /treasury-drive-files/status` reports `configured: true`.
3. Click "Sincronizar agora" on the real screen; confirm the Itaú and C6 (both statement and invoice) files from the real "agosto" folder appear, correctly typed, nothing from "comprovantes itau" or any non-allowlisted folder.
4. Click "Importar" on one file; confirm the account dropdown pre-selects sensibly, the period pre-fills from the real file's modified time; confirm.
5. Confirm the resulting row appears in the existing "Importar extratos" table (the one shown in the operator's own screenshot during this feature's design) with the right Fonte label, Linhas count, and Rejeitadas count.
6. Confirm in `treasury-service`'s own data that the new `PendingImport`/transactions are indistinguishable in shape from a manually uploaded one.

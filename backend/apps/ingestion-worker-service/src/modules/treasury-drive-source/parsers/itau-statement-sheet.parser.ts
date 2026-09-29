import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import type { ParseStatementLinesResult, StructuralPattern } from '../../treasury-ingestion/parsers/statement-line'
import { parseBrDate } from '../../treasury-ingestion/utils/date'
import { findBareMoneyInText, type FoundMoney } from '../../treasury-ingestion/utils/money'
import { normalizeForMatch } from '../../treasury-ingestion/utils/normalize'

/**
 * Itaú statement Google Sheet ("Entradas_Saidas_..."), the Drive-sourced counterpart to the
 * PDF `itau.parser.ts` — same bank, same real transactions, a different export format. Real
 * layout confirmed live against the actual Aug/2026 file (see task-5-report.md for the fetch
 * transcript): a fixed header block (Atualização/Nome/Agência/Conta/Lançamentos/Periodo — whose
 * value cells come back duplicated across columns, an ExcelJS merged-cell read artifact, not a
 * parsing concern here), one blank row, then the real transaction-table header:
 * `Data | Lançamento | Razão Social | CPF/CNPJ | Valor (R$) | Saldo (R$)`.
 *
 * Unlike the PDF, `Valor (R$)` arrives as an actual JS number in the real file (both the
 * ExcelJS and SheetJS-fallback readers agree on this) — not Brazilian-comma TEXT, so there is
 * nothing for `findBareMoneyInText` to parse in the common case; that regex requires a decimal
 * comma and would reject a plain "1300" or "-1386.36". It is kept as a defensive fallback for
 * the rare cell that DOES come back as text (same "don't reimplement Brazilian money parsing"
 * rule this codebase already follows elsewhere — see `parseAmountCell` below).
 */

const LANCAMENTOS_MARKER = 'Lançamentos'
const HEADER_SEARCH_WINDOW = 15
const REQUIRED_HEADERS = ['Data', 'Lançamento', 'Valor (R$)']

/**
 * Balance/limit SNAPSHOT lines, not movements — share the transaction table's exact row shape
 * (a date, a label, a number) but the number lives in "Saldo (R$)", not "Valor (R$)" (empty on
 * these rows). Confirmed against the real file: "SALDO TOTAL DISPONÍVEL DIA" once per day, and
 * "SALDO ANTERIOR" (the opening-balance carry-forward, dated to the prior month's last day)
 * once at the tail — the exact same ghost lines already found and fixed in the PDF parser (see
 * `ingestion-worker-service/CLAUDE.md`'s known-gaps entry). "SALDO EM CONTA CORRENTE" (a PDF-only
 * label, never seen in this sheet) is kept too — same underlying Itaú extrato, costs nothing if
 * it never fires here.
 */
const BALANCE_LINE_LABELS = ['SALDO TOTAL DISPONIVEL', 'SALDO ANTERIOR', 'SALDO EM CONTA CORRENTE']

/**
 * The same two structural facts `itau.parser.ts` (the PDF variant of this exact bank) already
 * encodes — reused rather than dropped. This is a different EXPORT FORMAT of the same
 * underlying statement, and both patterns are confirmed present in the real fetched file
 * (SISPAG FORNECEDORES ×15+, one JUROS line, Aug/2026) — neither line carries a Razão Social in
 * the sheet at all. Omitting the hint here would make the Drive-sourced path strictly worse
 * than the already-shipped PDF path for the identical real transaction: SISPAG would lose its
 * explicit "never guess a fornecedor" signal, and JUROS would lose the cross-bank "Juros -
 * Limite Garantido" unification (operator request — see `c6-statement.parser.ts`'s own "Cheque
 * especial" precedent). Note: this deliberately diverges from this task's own brief, which
 * claimed "Itaú's PDF parser does not set one either" — that claim does not match
 * `itau.parser.ts`'s actual code (its `PATTERNS`/`structuralHint` block, and its own spec's
 * "classifies a JUROS line as overdraft interest" test) — see task-5-report.md.
 */
const PATTERNS: StructuralPattern[] = [
  { matchText: 'SISPAG PAGAMENTO DE FORNECEDOR', kind: 'pending' },
  { matchText: 'SISPAG FORNECEDORES', kind: 'pending' },
  { matchText: 'JUROS', kind: 'expense', category: 'Juros - Limite Garantido' },
]

function cellText(value: unknown): string {
  return String(value ?? '').trim()
}

function rowHasAll(row: unknown[] | undefined, labels: string[]): boolean {
  const cells = (row ?? []).map(cellText)
  return labels.every(label => cells.some(cell => cell.includes(label)))
}

interface ColumnIndex {
  data: number
  lancamento: number
  razaoSocial: number
  valor: number
}

/**
 * Locates the real transaction-table header — never assumed at a fixed row, same discipline
 * `locateRawHeaderRow` (`ingestion/utils/row-mapping.ts`) already uses for the sales/
 * abastecimento workbooks. Finds the "Lançamentos" section marker first (already confirmed
 * present by `detectTreasurySheetSource` before this parser ever runs), then the real header
 * row within a window below it — never assumed to be immediately adjacent, since the real file
 * has a "Periodo:" row and a blank row in between.
 */
function locateHeaderRowIndex(rows: unknown[][]): number | null {
  let markerIndex = -1
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_WINDOW); i++) {
    if (rowHasAll(rows[i], [LANCAMENTOS_MARKER])) {
      markerIndex = i
      break
    }
  }
  if (markerIndex === -1) return null

  for (let i = markerIndex; i < Math.min(rows.length, markerIndex + HEADER_SEARCH_WINDOW); i++) {
    if (rowHasAll(rows[i], REQUIRED_HEADERS)) return i
  }

  return null
}

function buildColumnIndex(headerRow: unknown[] | undefined): ColumnIndex | null {
  const cells = (headerRow ?? []).map(cellText)
  const find = (label: string) => cells.findIndex(cell => cell === label)

  const data = find('Data')
  const lancamento = find('Lançamento')
  const valor = find('Valor (R$)')
  if (data === -1 || lancamento === -1 || valor === -1) return null

  return { data, lancamento, razaoSocial: find('Razão Social'), valor }
}

/**
 * `Valor (R$)` is a real JS number in the confirmed real file, so this is arithmetic, not
 * Brazilian-text money parsing — `findBareMoneyInText` is reused only for the defensive text-cell
 * fallback, never reimplemented for the number case.
 */
function parseAmountCell(value: unknown): FoundMoney | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { amountCents: Math.round(Math.abs(value) * 100), negative: value < 0 }
  }

  if (typeof value === 'string' && value.trim() !== '') return findBareMoneyInText(value)

  return null
}

export function parseItauStatementSheet(rows: unknown[][]): ParseStatementLinesResult {
  const result: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []

  const headerRowIndex = locateHeaderRowIndex(rows)
  if (headerRowIndex === null) {
    rejections.push({
      rowReference: 'header',
      reason: 'header_not_found',
      detail: 'Could not locate the "Lançamentos" transaction table header row (Data/Lançamento/Valor (R$))',
    })
    return { rows: result, rejections }
  }

  const columnIndex = buildColumnIndex(rows[headerRowIndex])
  if (!columnIndex) {
    rejections.push({
      rowReference: `row${headerRowIndex + 1}`,
      reason: 'unrecognized_columns',
      detail: 'Header row is missing an expected column (Data/Lançamento/Valor (R$))',
    })
    return { rows: result, rejections }
  }

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const rowReference = `row${i + 1}`

    const dataCell = cellText(row[columnIndex.data])
    if (!dataCell) continue // Trailing blank rows past the last real transaction.

    const label = cellText(row[columnIndex.lancamento])
    const normalizedLabel = normalizeForMatch(label)
    if (BALANCE_LINE_LABELS.some(pattern => normalizedLabel.includes(pattern))) continue

    const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataCell)
    const occurredOn = dateMatch ? parseBrDate(dateMatch[1], dateMatch[2], dateMatch[3]) : null
    if (!occurredOn) {
      rejections.push({ rowReference, reason: 'unparseable_date', detail: `"${dataCell}" is not a valid DD/MM/YYYY date` })
      continue
    }

    const money = parseAmountCell(row[columnIndex.valor])
    if (!money) {
      rejections.push({
        rowReference,
        reason: 'unparseable_amount',
        detail: `Could not read a valid amount from "Valor (R$)": ${JSON.stringify(row[columnIndex.valor])}`,
      })
      continue
    }

    const razaoSocial = cellText(row[columnIndex.razaoSocial])
    const counterpartyRaw = razaoSocial || label
    const structural = PATTERNS.find(pattern => normalizedLabel.includes(normalizeForMatch(pattern.matchText)))

    result.push({
      occurredOn,
      amountCents: money.amountCents,
      direction: money.negative ? 'outflow' : 'inflow',
      counterpartyRaw,
      sourceRef: rowReference,
      ...(structural ? { structuralHint: { kind: structural.kind, category: structural.category } } : {}),
    })
  }

  return { rows: result, rejections }
}

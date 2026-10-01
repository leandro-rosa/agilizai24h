import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import type { ParseStatementLinesResult } from '../../treasury-ingestion/parsers/statement-line'
import { C6_PATTERNS } from '../../treasury-ingestion/parsers/c6-statement.parser'
import { parseBrDate } from '../../treasury-ingestion/utils/date'
import { normalizeForMatch } from '../../treasury-ingestion/utils/normalize'

/**
 * C6 statement Google Sheet ("Extrato C6"), the Drive-sourced counterpart to the
 * PDF `c6-statement.parser.ts` — same bank, same real transactions, a different export format.
 * Real layout, confirmed against the real September 2026 file (a genuinely uploaded `.xlsx`,
 * not a native-Sheet export): a 7-row metadata preamble (title, blank, agência/conta,
 * "Extrato gerado em...", blank, period, blank), THEN the real transaction-table header —
 * `Data Lançamento, Data Contábil, Título, Descrição, Entrada(R$), Saída(R$), Saldo do Dia(R$)`.
 * The header row is LOCATED within a window, never assumed to be `rows[0]` — the earlier
 * assumption (this file, before this fix) silently rejected the entire real September file as
 * `unrecognized_columns` because row 0 is "EXTRATO DE CONTA CORRENTE C6 BANK", not the header.
 * Same convention `itau-statement-sheet.parser.ts`/`pagbank-statement-sheet.parser.ts` already
 * use for exactly this reason.
 *
 * Like the Itaú sheet parser, `Título` can carry bank-printed structural patterns
 * (e.g., "SEGURO CONTA C6 Ago 26", "JUROS CHEQUE ESP") — the same patterns the PDF
 * parser already recognizes in raw bank text. Sheet exports transform these patterns
 * by adding date suffixes (the human-readable month), but the core pattern is preserved
 * in `Título` and is a genuine structural signal (never a manual operator classification).
 * `Tipo` and `Detalhe` are the operator's classifications and are deliberately NOT used for
 * `structuralHint`, distinguishing operator input from bank-printed format signals.
 */

/**
 * The columns this parser actually reads — same "only what's consumed, never the whole real
 * layout" discipline as `itau-statement-sheet.parser.ts`'s own `REQUIRED_HEADERS` (`Data
 * Contábil`/`Tipo`/`Detalhe` are real columns of the export but nothing here reads them). A
 * header row missing one of these rejects the whole file (`unrecognized_columns`) instead of
 * silently reading `undefined` cells row after row.
 */
const REQUIRED_HEADERS = ['Data Lançamento', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)']
const HEADER_SEARCH_WINDOW = 15

function cellText(value: unknown): string {
  if (value && typeof value === 'object' && 'richText' in value) {
    return (value as { richText: { text: string }[] }).richText.map(part => part.text).join('')
  }
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text ?? '')
  return String(value ?? '').trim()
}

function rowHasAll(row: unknown[] | undefined, labels: string[]): boolean {
  const cells = (row ?? []).map(cell => cellText(cell))
  return labels.every(label => cells.some(cell => cell === label))
}

function locateHeaderRowIndex(rows: unknown[][]): number | null {
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_WINDOW); i++) {
    if (rowHasAll(rows[i], REQUIRED_HEADERS)) return i
  }
  return null
}

function buildColumnIndex(header: unknown[]): Record<string, number> | null {
  const index: Record<string, number> = {}
  header.forEach((cell, i) => {
    const key = cellText(cell)
    if (key) index[key] = i
  })
  return REQUIRED_HEADERS.every(name => name in index) ? index : null
}

function toDateOnly(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
    // The real September file stores this column as DD/MM/YYYY text, not an ISO string or a
    // native Date — found live against the real file (August's genuinely differed, an ISO-ish
    // native-Sheet export), same month-to-month format variance this bank's other sources show.
    const brDateMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    if (brDateMatch) {
      const [, day, month, year] = brDateMatch
      return parseBrDate(day, month, year)
    }
  }
  return null
}

function toAmountCents(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export function parseC6StatementSheet(rows: unknown[][]): ParseStatementLinesResult {
  const result: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []

  const headerRowIndex = locateHeaderRowIndex(rows)
  if (headerRowIndex === null) {
    rejections.push({
      rowReference: 'header',
      reason: 'unrecognized_columns',
      detail: `Could not locate a header row containing all of ${REQUIRED_HEADERS.join(', ')}`,
    })
    return { rows: result, rejections }
  }

  const columnIndex = buildColumnIndex(rows[headerRowIndex])!

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const rowReference = `row${i + 1}`

    // A genuinely blank trailing row (common padding at the end of a real export) is not a
    // transaction candidate — skip without rejecting, same discipline as
    // `itau-statement-sheet.parser.ts`'s "not every line is a transaction" rule.
    if (row.every(cell => !cellText(cell))) continue

    const occurredOn = toDateOnly(row[columnIndex['Data Lançamento']])
    if (!occurredOn) {
      rejections.push({ rowReference, reason: 'unparseable_date', detail: `"Data Lançamento" is not a recognisable date: ${JSON.stringify(row[columnIndex['Data Lançamento']])}` })
      continue
    }

    const entrada = toAmountCents(row[columnIndex['Entrada(R$)']]) ?? 0
    const saida = toAmountCents(row[columnIndex['Saída(R$)']]) ?? 0

    if (entrada === 0 && saida === 0) {
      rejections.push({ rowReference, reason: 'no_amount', detail: 'Neither Entrada(R$) nor Saída(R$) is populated' })
      continue
    }

    const titulo = cellText(row[columnIndex['Título']])
    const normalizedTitulo = normalizeForMatch(titulo)
    const structural = C6_PATTERNS.find(pattern => normalizedTitulo.includes(normalizeForMatch(pattern.matchText)))

    result.push({
      occurredOn,
      amountCents: entrada > 0 ? entrada : saida,
      direction: entrada > 0 ? 'inflow' : 'outflow',
      counterpartyRaw: cellText(row[columnIndex['Descrição']]),
      sourceRef: rowReference,
      ...(structural ? { structuralHint: { kind: structural.kind, category: structural.category } } : {}),
    })
  }

  return { rows: result, rejections }
}

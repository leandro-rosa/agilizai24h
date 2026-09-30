import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import type { ParseStatementLinesResult } from '../../treasury-ingestion/parsers/statement-line'
import { C6_PATTERNS } from '../../treasury-ingestion/parsers/c6-statement.parser'
import { normalizeForMatch } from '../../treasury-ingestion/utils/normalize'

/**
 * C6 statement Google Sheet ("Extrato C6"), the Drive-sourced counterpart to the
 * PDF `c6-statement.parser.ts` — same bank, same real transactions, a different export format.
 * Real layout: `Data Lançamento, Data Contábil, Título, Descrição, Entrada(R$), Saída(R$), Tipo, Detalhe`.
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
 * silently reading `undefined` cells row after row — the same bug class `buildColumnIndex`
 * (Itaú sheet parser) already guards against.
 */
const REQUIRED_HEADERS = ['Data Lançamento', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)']

function buildColumnIndex(header: unknown[]): Record<string, number> | null {
  const index: Record<string, number> = {}
  header.forEach((cell, i) => {
    const key = String(cell ?? '').trim()
    if (key) index[key] = i
  })
  return REQUIRED_HEADERS.every(name => name in index) ? index : null
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
  const columnIndex = buildColumnIndex(header ?? [])
  const result: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []

  if (!columnIndex) {
    rejections.push({
      rowReference: 'header',
      reason: 'unrecognized_columns',
      detail: `Header row is missing an expected column (${REQUIRED_HEADERS.join(', ')})`,
    })
    return { rows: result, rejections }
  }

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

    const titulo = String(row[columnIndex['Título']] ?? '').trim()
    const normalizedTitulo = normalizeForMatch(titulo)
    const structural = C6_PATTERNS.find(pattern => normalizedTitulo.includes(normalizeForMatch(pattern.matchText)))

    result.push({
      occurredOn,
      amountCents: entrada > 0 ? entrada : saida,
      direction: entrada > 0 ? 'inflow' : 'outflow',
      counterpartyRaw: String(row[columnIndex['Descrição']] ?? '').trim(),
      sourceRef: rowReference,
      ...(structural ? { structuralHint: { kind: structural.kind, category: structural.category } } : {}),
    })
  })

  return { rows: result, rejections }
}

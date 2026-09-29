import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import type { ParseStatementLinesResult } from '../../treasury-ingestion/parsers/statement-line'

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

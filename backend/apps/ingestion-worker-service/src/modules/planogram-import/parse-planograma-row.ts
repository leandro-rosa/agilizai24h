import { readRawColumn, toQuantity } from '../ingestion/utils/row-mapping'

export interface PlanogramaRow {
  codigoProduto: string
  minimoCritico: number | null
  nivelDePar: number | null
  quantidadeAtual: number | null
}

/**
 * `readRawColumn` expects a header-text-keyed row object (how it reads any
 * other raw workbook row, before `smartChunk`) — the planograma export is
 * read positionally alongside a located header row, so this rebuilds that
 * shape rather than introducing a second, positional lookup convention.
 */
function toRawRow(row: unknown[], columnIndex: Record<string, number>): Record<string, unknown> {
  const rawRow: Record<string, unknown> = {}
  for (const [header, index] of Object.entries(columnIndex)) {
    rawRow[header] = row[index]
  }
  return rawRow
}

export function parsePlanogramaRow(row: unknown[], columnIndex: Record<string, number>): PlanogramaRow | null {
  const rawRow = toRawRow(row, columnIndex)

  const codigoProduto = readRawColumn(rawRow, 'productCode')
  if (codigoProduto === undefined || codigoProduto === null || String(codigoProduto).trim() === '') return null

  return {
    codigoProduto: String(codigoProduto).trim(),
    minimoCritico: toQuantity(readRawColumn(rawRow, 'minimumCritical')),
    nivelDePar: toQuantity(readRawColumn(rawRow, 'parLevel')),
    quantidadeAtual: toQuantity(readRawColumn(rawRow, 'currentQuantity')),
  }
}

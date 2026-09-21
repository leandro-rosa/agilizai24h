import { locateRestockingOperations } from '../../ingestion/utils/locate-restocking-operations'
import type { SheetRows } from '../../ingestion/utils/read-workbook-rows'
import { hasRawColumn, locateRawHeaderRow, toExcelDate, type ColumnKey } from '../../ingestion/utils/row-mapping'
import type { ContentSummary, StoreDays } from '../types/validation.types'

/**
 * The columns the worker cannot read a network sales file without — the same
 * list `ParseFileWorker` enforces. Reusing it, rather than a looser test of
 * "has a Cliente column", is what keeps validation from calling a file network
 * sales that the real parse would then reject.
 */
const NETWORK_SALES_COLUMNS: ColumnKey[] = ['clientStore', 'product', 'quantity', 'result']

const HEADER_SEARCH_WINDOW = 10

const indexOfColumn = (headers: string[], key: ColumnKey): number => headers.findIndex(header => hasRawColumn([header], key))

const isEmptyRow = (row: unknown[]): boolean => row.every(cell => cell === null || cell === undefined || String(cell).trim() === '')

/** The store as it is compared everywhere: trimmed, with runs of whitespace collapsed. */
const foldStoreName = (raw: unknown): string => String(raw ?? '').trim().replace(/\s+/g, ' ')

const monthKey = (date: Date): string => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`

interface SalesSheet {
  headers: string[]
  headerRowIndex: number
  rows: unknown[][]
}

function networkSalesSheets(sheets: SheetRows[]): SalesSheet[] {
  const found: SalesSheet[] = []

  for (const sheet of sheets) {
    const headerRowIndex = locateRawHeaderRow(sheet.rows, 'clientStore', HEADER_SEARCH_WINDOW)
    if (headerRowIndex === null) continue

    const headers = (sheet.rows[headerRowIndex] ?? []).map(value => String(value ?? ''))
    if (NETWORK_SALES_COLUMNS.every(key => indexOfColumn(headers, key) >= 0)) {
      found.push({ headers, headerRowIndex, rows: sheet.rows })
    }
  }

  return found
}

function summarizeNetworkSales(sales: SalesSheet[]): ContentSummary {
  const monthHistogram: Record<string, number> = {}
  const storeDays: Record<string, Record<string, StoreDays>> = {}
  let rowCount = 0
  let undatedRows = 0

  for (const sheet of sales) {
    const clientIndex = indexOfColumn(sheet.headers, 'clientStore')
    const dateIndex = indexOfColumn(sheet.headers, 'occurredAt')

    for (const row of sheet.rows.slice(sheet.headerRowIndex + 1)) {
      if (isEmptyRow(row)) continue
      rowCount++

      // A missing date column is not an error here: every row simply reads as undated,
      // which the identity check turns into "the period could not be verified".
      const date = dateIndex >= 0 ? toExcelDate(row[dateIndex]) : null
      if (date === null) {
        undatedRows++
        continue
      }

      const month = monthKey(date)
      monthHistogram[month] = (monthHistogram[month] ?? 0) + 1

      const store = foldStoreName(row[clientIndex])
      if (store === '') continue

      // Any result counts: a day with only declined attempts is still a day the store operated.
      const stores = (storeDays[month] ??= {})
      const days = (stores[store] ??= { rows: 0, dayMask: 0 })
      days.rows++
      days.dayMask |= 1 << (date.getUTCDate() - 1)
    }
  }

  return { format: 'network_sales', rowCount, monthHistogram, undatedRows, storeDays }
}

function looksLikeLegacyStoreSales(sheets: SheetRows[]): SheetRows | null {
  const first = sheets[0]
  if (!first) return null

  for (let i = 0; i < Math.min(first.rows.length, HEADER_SEARCH_WINDOW); i++) {
    const headers = (first.rows[i] ?? []).map(value => String(value ?? ''))
    if (indexOfColumn(headers, 'product') >= 0 && indexOfColumn(headers, 'quantity') >= 0 && indexOfColumn(headers, 'clientStore') < 0) {
      return { sheetName: first.sheetName, rows: first.rows.slice(i + 1) }
    }
  }

  return null
}

/**
 * Reduces a workbook to the aggregates the checks read, and to nothing else: the
 * format, counts, dates by month and — for sales — which days each store has at
 * least one row. No coupon, product, buyer number or card digit survives, so what
 * is stored can be kept, shown and re-evaluated without ever holding the file.
 *
 * Detection reuses the worker's own readers, restocking FIRST: a restocking sheet
 * also carries a "Cliente" column, and only its operation blocks tell it apart
 * from sales.
 */
export function summarizeWorkbook(sheets: SheetRows[]): ContentSummary {
  const restocking = locateRestockingOperations(sheets)

  if (restocking.operations.length > 0) {
    const monthHistogram: Record<string, number> = {}
    let undatedRows = 0

    for (const operation of restocking.operations) {
      if (operation.finishedAt === null) {
        undatedRows++
        continue
      }
      const month = monthKey(operation.finishedAt)
      monthHistogram[month] = (monthHistogram[month] ?? 0) + 1
    }

    return { format: 'supply', rowCount: restocking.operations.length, monthHistogram, undatedRows, storeDays: {} }
  }

  const sales = networkSalesSheets(sheets)
  if (sales.length > 0) return summarizeNetworkSales(sales)

  const legacy = looksLikeLegacyStoreSales(sheets)
  if (legacy) {
    const rowCount = legacy.rows.filter(row => !isEmptyRow(row)).length
    return { format: 'legacy_store_sales', rowCount, monthHistogram: {}, undatedRows: rowCount, storeDays: {} }
  }

  return { format: 'unknown', rowCount: 0, monthHistogram: {}, undatedRows: 0, storeDays: {} }
}

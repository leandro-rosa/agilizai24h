import { hasRawColumn, locateRawHeaderRow, readRawColumn, toExcelDate, type ColumnKey } from './row-mapping'
import { resolveOperationKind, type OperationKindKey } from './operation-kinds'
import type { SheetRows } from './read-workbook-rows'

/** Every column a restocking product row must carry, beyond the code that locates the table. */
const REQUIRED_PRODUCT_COLUMNS: ColumnKey[] = [
  'openingBalance',
  'restocked',
  'removedTotal',
  'removalDetail',
  'adjustment',
  'recordedClosingBalance',
]

/**
 * One sheet's operation block, read from its header rows — before any product
 * row is touched.
 *
 * The restocking workbook covers every store in the month, one sheet per
 * operation, so the store and operation kind live in the SHEET, not in
 * anything the uploader states (design D2). This is read once, up front, so
 * every product-row job later only needs to look itself up by sheet name
 * rather than re-reading the workbook.
 */
export interface RestockingOperation {
  sheetName: string
  clientRaw: string
  operationKind: OperationKindKey
  finishedAt: Date | null
  /** 1-indexed — where this sheet's product table header actually is. */
  productHeaderRowNumber: number
}

export interface UnparseableSheet {
  sheetName: string
  reason: string
}

export interface LocateRestockingResult {
  operations: RestockingOperation[]
  unparseableSheets: UnparseableSheet[]
  /**
   * The row every parseable sheet's product header shares — `smartChunk`
   * takes one `headersRow` for the whole workbook, so every sheet must agree.
   * Null when there were no parseable sheets to compare, or when they
   * disagreed (see `inconsistentHeaderRows`).
   */
  headerRowNumber: number | null
  /**
   * True when parseable sheets located their product header at DIFFERENT
   * rows. Never observed across the 7 months this was measured against, but
   * the file must fail rather than silently mis-chunk some of its sheets —
   * see design D1's "locate, don't assume" applied to the file as a whole.
   */
  inconsistentHeaderRows: boolean
  /**
   * Every required product column absent from the shared header row — checked
   * once, since every parseable sheet's product table shares the same header
   * (design task 2.6). A column absent here would otherwise read as `null` on
   * every row rather than failing the file — the exact silent-zero shape this
   * change exists to close.
   */
  missingRequiredColumns: ColumnKey[]
}

const SEARCH_WINDOW = 10

/**
 * Reads every sheet's operation header (store, kind, loss totals) and locates
 * its product table, without touching a single product row — `smartChunk`
 * does that afterwards, once `headerRowNumber` is known.
 */
export function locateRestockingOperations(sheets: SheetRows[]): LocateRestockingResult {
  const operations: RestockingOperation[] = []
  const unparseableSheets: UnparseableSheet[] = []
  let productHeaderRow: string[] | null = null

  for (const sheet of sheets) {
    const rows = sheet.rows.slice(0, SEARCH_WINDOW)

    const labelRowIndex = locateRawHeaderRow(rows, 'clientStore', SEARCH_WINDOW)

    if (labelRowIndex === null) {
      unparseableSheets.push({
        sheetName: sheet.sheetName,
        reason: `No operation header ("Cliente") found in the first ${SEARCH_WINDOW} rows`,
      })
      continue
    }

    const labels = (rows[labelRowIndex] ?? []).map(value => String(value ?? ''))
    const values = rows[labelRowIndex + 1] ?? []
    const headerRecord = Object.fromEntries(labels.map((label, index) => [label, values[index]]))

    const clientRaw = String(readRawColumn(headerRecord, 'clientStore') ?? '').trim()
    const operationKindLabel = String(readRawColumn(headerRecord, 'operationKind') ?? '').trim()

    if (clientRaw === '') {
      unparseableSheets.push({ sheetName: sheet.sheetName, reason: 'The operation header names no store (Cliente)' })
      continue
    }

    const operationKind = resolveOperationKind(operationKindLabel)

    if (!operationKind) {
      unparseableSheets.push({
        sheetName: sheet.sheetName,
        reason: `Unrecognised operation kind "${operationKindLabel}"`,
      })
      continue
    }

    const productHeaderRowIndex = locateRawHeaderRow(rows, 'productCode', SEARCH_WINDOW)

    if (productHeaderRowIndex === null) {
      unparseableSheets.push({
        sheetName: sheet.sheetName,
        reason: `No product table header ("Código Produto") found in the first ${SEARCH_WINDOW} rows`,
      })
      continue
    }

    if (productHeaderRow === null) {
      productHeaderRow = (rows[productHeaderRowIndex] ?? []).map(value => String(value ?? ''))
    }

    operations.push({
      sheetName: sheet.sheetName,
      clientRaw,
      operationKind,
      finishedAt: toExcelDate(readRawColumn(headerRecord, 'finishedAt')),
      // 0-indexed here; +1 for the 1-indexed row number `smartChunk`'s `headersRow` expects.
      productHeaderRowNumber: productHeaderRowIndex + 1,
    })
  }

  const distinctHeaderRows = [...new Set(operations.map(operation => operation.productHeaderRowNumber))]

  return {
    operations,
    unparseableSheets,
    headerRowNumber: distinctHeaderRows.length === 1 ? distinctHeaderRows[0] : null,
    inconsistentHeaderRows: distinctHeaderRows.length > 1,
    missingRequiredColumns:
      productHeaderRow === null
        ? []
        : REQUIRED_PRODUCT_COLUMNS.filter(column => !hasRawColumn(productHeaderRow!, column)),
  }
}

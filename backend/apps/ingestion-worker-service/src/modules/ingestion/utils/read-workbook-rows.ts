import * as fs from 'fs'
import * as XLSX from 'xlsx'

export interface SheetRows {
  sheetName: string
  /** 0-indexed rows; each row's values 0-indexed by column. */
  rows: unknown[][]
}

/**
 * Reads a workbook's every sheet as a plain row matrix, with the same
 * resilience `@app/sheeter` already has: try ExcelJS first, and fall back to
 * SheetJS when it fails or reports no worksheets.
 *
 * `ParseFileWorker` needs to inspect a workbook (locate the restocking
 * operation blocks, or check a flat file's row-1 headers) BEFORE handing it
 * to `smartChunk` for the real chunking pass — and it turns out real exports
 * exist that ExcelJS's own `readFile` cannot parse at all (observed live,
 * during the March 2026 backfill: `Cannot read properties of undefined
 * (reading 'sheets')`, reproducible standalone, unrelated to file size or
 * content — an ExcelJS limitation, not a malformed file). `smartChunk`
 * already tolerates this via its own fallback; reading the workbook here
 * with anything less would fail files `smartChunk` could otherwise chunk.
 */
export async function readWorkbookRows(filePath: string): Promise<SheetRows[]> {
  try {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(filePath)

    if (workbook.worksheets.length > 0) {
      return workbook.worksheets.map(sheet => ({
        sheetName: sheet.name,
        rows: rowsFromExcelJSSheet(sheet),
      }))
    }
  } catch {
    // Falls through to the SheetJS reader below.
  }

  return readWithSheetJS(filePath)
}

function rowsFromExcelJSSheet(sheet: { rowCount: number; getRow: (n: number) => { values: unknown } }): unknown[][] {
  const rows: unknown[][] = []

  for (let r = 1; r <= sheet.rowCount; r++) {
    const values = sheet.getRow(r).values
    // ExcelJS rows are 1-indexed and `values[0]` is always empty.
    rows.push(Array.isArray(values) ? values.slice(1) : [])
  }

  return rows
}

function readWithSheetJS(filePath: string): SheetRows[] {
  let workbook: XLSX.WorkBook

  try {
    workbook = XLSX.read(fs.readFileSync(filePath), { type: 'buffer', cellDates: true })
  } catch {
    // Last resort: SheetJS's own file reader, for shapes its buffer reader rejects.
    workbook = XLSX.readFile(filePath, { cellDates: true })
  }

  return workbook.SheetNames.map(sheetName => ({
    sheetName,
    // Options matched EXACTLY to `@app/sheeter`'s own SheetJS fallback
    // (`rowsPerSheetFromSheetJS`) — not a style choice. `blankrows: false`
    // drops the blank row between a restocking operation's two tables,
    // shifting every row number that follows it. If this reader and
    // `smartChunk`'s disagreed on that, `headerRowNumber` here would name a
    // different row than the one `smartChunk` actually treats as the
    // header — observed live: every row of a real file was rejected as
    // "missing product" because the row AFTER the header was read as the
    // header instead.
    rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, blankrows: false, defval: null }),
  }))
}

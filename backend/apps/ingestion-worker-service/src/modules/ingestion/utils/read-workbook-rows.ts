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

  return workbook.SheetNames.map(sheetName => {
    const sheet = workbook.Sheets[sheetName]
    repairUnderstatedRange(sheet)

    return {
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
      rows: XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: null }),
    }
  })
}

/**
 * A real file's own `!ref` dimension can understate its actual populated range — found live
 * against a real September 2026 Itaú statement: the file declares `A1:F13`, but its genuinely
 * populated cells continue for the whole month's worth of transactions. `sheet_to_json` trusts
 * `!ref` and silently drops everything beyond it, with no error — not a corrupt file, a stale
 * dimension tag some export tools leave behind. Recomputed here from the sheet's own real cell
 * addresses, which is always at least as wide as the declared range and never narrower, so a
 * file whose `!ref` is already correct is unaffected.
 */
function repairUnderstatedRange(sheet: XLSX.WorkSheet): void {
  let maxRow = -1
  let maxCol = -1

  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue
    const cell = XLSX.utils.decode_cell(key)
    if (cell.r > maxRow) maxRow = cell.r
    if (cell.c > maxCol) maxCol = cell.c
  }

  if (maxRow === -1) return // no real cells at all — nothing to repair

  const declaredRange = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null
  if (declaredRange && declaredRange.e.r >= maxRow && declaredRange.e.c >= maxCol) return // already wide enough

  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } })
}

import { join } from 'node:path'
import { readWorkbookRows } from './read-workbook-rows'

/**
 * A real September 2026 Itaú statement, found live during treasury Drive manual acceptance:
 * its own `!ref` dimension declares `A1:F13`, but the file's genuinely populated cells continue
 * well past row 13 (confirmed: the real file has transaction lines for the whole month). Neither
 * ExcelJS (throws on this file's `lastModifiedBy` XML shape, falling through as designed) nor
 * SheetJS's default `sheet_to_json` (trusts the understated `!ref`) read past row 13 without the
 * fix this file's own test exists to pin.
 */
const TRUNCATED_RANGE_FIXTURE = join(__dirname, 'test/fixtures/itau-statement-truncated-range.xlsx')

describe('readWorkbookRows', () => {
  it('reads past a real file\'s own understated !ref dimension, instead of silently truncating', async () => {
    const sheets = await readWorkbookRows(TRUNCATED_RANGE_FIXTURE)
    expect(sheets).toHaveLength(1)
    // The real file's own declared range (A1:F13) would cap this at 10 rows (blankrows: false
    // drops none here) — the real file has many more, through the whole September statement.
    expect(sheets[0].rows.length).toBeGreaterThan(50)
    // The real last data line of the file, confirmed by direct inspection of the real Drive file's
    // content — proves the fix reads all the way to the genuine end, not just "a bit further".
    const lastRow = sheets[0].rows[sheets[0].rows.length - 1]
    expect(lastRow).toEqual(['31/08/2026', 'SALDO ANTERIOR', '', '', null, 5686.12])
  })
})

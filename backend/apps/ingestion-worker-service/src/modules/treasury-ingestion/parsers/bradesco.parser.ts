import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import { parseBrDate } from '../utils/date'
import { parseBrlAmountToCents } from '../utils/money'
import { readWorkbookRows } from '../../ingestion/utils/read-workbook-rows'

const BR_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/

function cellText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

/**
 * Bradesco extrato — the real export (measured 2026-08, design.md D9) is a
 * genuine `.xlsx`, not the semicolon CSV originally assumed, so this reuses
 * `readWorkbookRows` (`src/modules/ingestion/utils/read-workbook-rows.ts`,
 * already used by the sales/supply/cost pipeline) instead of `csv-parse`.
 * The header isn't row 1 — rows 1-8 are account boilerplate ("Bradesco Net
 * Empresa", "Extrato de: Agência..."), so the header is located by content
 * ("Data"/"Lançamento" in the first two cells), not assumed at a fixed row
 * number. Two signed value columns (Crédito/Débito), never one combined
 * `Valor`; `Débito` itself already carries a leading "-" in the cell text
 * ("-168,50"), which `parseBrlAmountToCents` needs stripped first (it
 * expects an unsigned digit pattern). A `Total` row closes the table — the
 * real file has a SECOND, differently-shaped table below it ("Saldos Invest
 * Fácil", its own 3-column header, 34 rows of balance snapshots, not
 * movements) that this must never reach: stopping at `Total` is what keeps
 * it out, rather than needing to recognise and skip that second header too.
 */
export async function parseBradescoStatement(filePath: string): Promise<{ rows: TreasuryRawRow[]; rejections: TreasuryRawRejection[] }> {
  const rows: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []

  let sheets: { sheetName: string; rows: unknown[][] }[]
  try {
    sheets = await readWorkbookRows(filePath)
  } catch (error) {
    rejections.push({ rowReference: 'file', reason: 'unparseable_file', detail: `Could not read the workbook: ${(error as Error).message}` })
    return { rows, rejections }
  }

  const allRows = sheets.flatMap(sheet => sheet.rows)
  const headerIndex = allRows.findIndex(row => cellText(row[0]) === 'Data' && cellText(row[1]) === 'Lançamento')

  if (headerIndex === -1) {
    rejections.push({
      rowReference: 'header',
      reason: 'missing_columns',
      detail: 'No "Data | Lançamento | Dcto. | Crédito (R$) | Débito (R$) | Saldo (R$)" header row found in the workbook',
    })
    return { rows, rejections }
  }

  for (let index = headerIndex + 1; index < allRows.length; index += 1) {
    const row = allRows[index]
    const rowReference = `row${index + 1}` // ExcelJS rows are 1-indexed; readWorkbookRows preserves that offset.

    const firstCell = cellText(row[0])
    if (firstCell === 'Total') break // the second, differently-shaped table starts after this — never reached
    if (firstCell === '') continue // a blank separator row
    if (cellText(row[1]) === 'SALDO ANTERIOR') continue // opening-balance carry-forward, not a movement

    const dateMatch = BR_DATE_PATTERN.exec(firstCell)
    const occurredOn = dateMatch ? parseBrDate(dateMatch[1], dateMatch[2], dateMatch[3]) : null
    if (!occurredOn) {
      rejections.push({ rowReference, reason: 'unparseable_date', detail: `"${firstCell}" is not DD/MM/YYYY` })
      continue
    }

    const credito = cellText(row[3])
    const debito = cellText(row[4])
    const direction = credito !== '' ? 'inflow' : debito !== '' ? 'outflow' : null
    if (!direction) {
      rejections.push({ rowReference, reason: 'unparseable_amount', detail: 'Row has neither a Crédito nor a Débito value' })
      continue
    }

    const amountCents = parseBrlAmountToCents(direction === 'inflow' ? credito : debito.replace(/^-/, ''))
    if (amountCents === null) {
      rejections.push({ rowReference, reason: 'unparseable_amount', detail: `"${direction === 'inflow' ? credito : debito}" is not a recognisable amount` })
      continue
    }

    rows.push({
      occurredOn,
      amountCents,
      direction,
      counterpartyRaw: cellText(row[1]),
      sourceRef: rowReference,
    })
  }

  return { rows, rejections }
}

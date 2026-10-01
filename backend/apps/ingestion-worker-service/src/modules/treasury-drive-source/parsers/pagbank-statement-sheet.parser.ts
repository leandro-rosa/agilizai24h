import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'

/**
 * PagBank statement Google Sheet (a `.xlsx` the real Drive folder serves with a misleading
 * `application/pdf` mimeType — see Task 6's shared reader). Real layout, confirmed during design
 * research against the real September file: a short metadata block (Nome do Titular/Banco/
 * Agência/Conta/Período), blank rows, then the real transaction-table header at 0-indexed row 8
 * of that file — `Data, Tipo, Descrição, Entradas, Saidas, Saldo` — same shape
 * `detectTreasurySheetSource`'s PagBank branch already searches for (Task 3).
 *
 * The header row is LOCATED within a window, never assumed to be `rows[0]` — unlike
 * `c6-statement-sheet.parser.ts`, whose real export has no preamble at all. Task 8's own routing
 * plan calls `SHEET_PARSERS[detectedSource](result.sheets[0].rows)` with the FULL sheet rows,
 * metadata preamble included; a parser that destructured `const [header, ...dataRows] = rows`
 * would read the "Nome do Titular" line as the header and silently reject every real row as
 * `unparseable_date`. Column POSITIONS within the located header row are still resolved purely
 * by name (`toColumnIndex`), which is what tolerates the real file's merged-cell artifact
 * (a label's rich-text value repeated across the columns its merge spans) without needing to
 * know the exact position in advance — same principle as `itau-statement-sheet.parser.ts`'s
 * `buildColumnIndex`.
 */

const REQUIRED_HEADERS = ['Data', 'Entradas', 'Saidas']
const HEADER_SEARCH_WINDOW = 15

function cellText(value: unknown): string {
  if (value && typeof value === 'object' && 'richText' in value) {
    return (value as { richText: { text: string }[] }).richText.map(part => part.text).join('')
  }
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text ?? '')
  return String(value ?? '').trim()
}

function rowHasAll(row: unknown[] | undefined, labels: string[]): boolean {
  const cells = (row ?? []).map(cell => cellText(cell).trim())
  return labels.every(label => cells.some(cell => cell.includes(label)))
}

function locateHeaderRowIndex(rows: unknown[][]): number | null {
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_WINDOW); i++) {
    if (rowHasAll(rows[i], REQUIRED_HEADERS)) return i
  }
  return null
}

function toColumnIndex(header: unknown[]): Record<string, number> {
  const index: Record<string, number> = {}
  header.forEach((cell, i) => {
    const key = cellText(cell).trim()
    if (key && index[key] === undefined) index[key] = i
  })
  return index
}

function toDateOnly(value: unknown): string | null {
  const text = cellText(value)
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return null
  const [, day, month, year] = match
  return `${year}-${month}-${day}`
}

function toAmountCents(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(cellText(value))
  if (!Number.isFinite(n) || cellText(value) === '') return null
  return Math.round(n * 100)
}

export function parsePagBankStatementSheet(rows: unknown[][]): { rows: TreasuryRawRow[]; rejections: TreasuryRawRejection[] } {
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

  const columnIndex = toColumnIndex(rows[headerRowIndex])

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const rowReference = `row${i + 1}`

    // A genuinely blank trailing row (common padding at the end of a real export) is not a
    // transaction candidate — skip without rejecting, same discipline as
    // `itau-statement-sheet.parser.ts`'s "not every line is a transaction" rule.
    if (row.every(cell => !cellText(cell))) continue

    const occurredOn = toDateOnly(row[columnIndex['Data']])
    if (!occurredOn) {
      rejections.push({ rowReference, reason: 'unparseable_date', detail: `"Data" is not a recognisable date: ${JSON.stringify(row[columnIndex['Data']])}` })
      continue
    }

    const entradas = toAmountCents(row[columnIndex['Entradas']]) ?? 0
    const saidas = toAmountCents(row[columnIndex['Saidas']]) ?? 0

    if (entradas === 0 && saidas === 0) {
      rejections.push({ rowReference, reason: 'no_amount', detail: 'Neither Entradas nor Saidas is populated' })
      continue
    }

    result.push({
      occurredOn,
      amountCents: entradas > 0 ? entradas : saidas,
      direction: entradas > 0 ? 'inflow' : 'outflow',
      counterpartyRaw: cellText(row[columnIndex['Descrição']]),
      sourceRef: rowReference,
    })
  }

  return { rows: result, rejections }
}

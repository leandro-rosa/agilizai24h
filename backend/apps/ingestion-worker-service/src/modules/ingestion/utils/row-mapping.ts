import slugify from 'slugify'
import { normalizeReasonText } from './parse-removal-reasons'

/**
 * The reports come from a Portuguese-language POS export (touchpay/AmLabs),
 * and headers are matched by their real column names — not invented ones. A
 * prior version of this file guessed at column names before any real export
 * had been read; the guess for the removal-reason column matched `Remoções`,
 * which in the real file is the removed-quantity NUMBER, while the reason
 * text sits in a separate column, `Detalhes das Remoções`, that was never
 * read. Nothing failed — it silently read the wrong column and produced a
 * plausible wrong value. See design D1 of `align-ingestion-with-real-reports`.
 *
 * Kept as a lookup rather than fixed column positions: the exports are not
 * guaranteed to keep column order, and a positional read would silently pick
 * up the wrong column rather than failing.
 *
 * The canonical alias values below are the real Portuguese header text. Two
 * lookup tables are derived from them, because a header reaches this module
 * through two different pipelines that transform it differently:
 *
 * - `hasColumn`/raw contexts (reading a workbook directly via ExcelJS, before
 *   `@app/sheeter` ever sees it) see the header text unchanged.
 * - `readColumn` sees `@app/sheeter`'s `smartChunk` output, whose row keys
 *   have already been run through `slugify` (spaces and most punctuation
 *   become `_`, accents are transliterated) — see
 *   `@app/sheeter`'s `normalizeHeaders`.
 *
 * Deriving both tables from one canonical list, rather than hand-maintaining
 * two, is what keeps them from silently drifting apart.
 */
export const COLUMN_ALIASES = {
  product: ['Nome produto', 'Descrição', 'Produto', 'Item'],
  productCode: ['Código Produto', 'Código', 'sku'],
  quantity: ['Qtd. vendida', 'Quantidade Vendida'],
  amount: ['Valor Vendido', 'Valor Total'],
  /** Units restocked this operation. Absent (not zero) on a pure Inventário row. */
  restocked: ['Qtd. abastecida'],
  /**
   * The removed-quantity NUMBER — always zero or negative in the real export.
   * NOT the reason text; see `removalDetail`. This is the column the earlier,
   * invented alias list matched to `removals`, which is what produced the
   * wrong-column bug this change fixes.
   */
  removedTotal: ['Remoções'],
  /** The free-text reason breakdown, e.g. "-4 Validade vencida, -6 Devolução". */
  removalDetail: ['Detalhes das Remoções'],
  /**
   * Signed inventory adjustment — inbound from another store, outbound for
   * transfer or return, or the residue of a self-checkout mismatch or a
   * data-entry error. Never a restock, never a removal. See design D4/D6.
   */
  adjustment: ['Diferença'],
  /** Opening balance for this operation's balance-identity check. */
  openingBalance: ['Qtd. Anterior'],
  /**
   * The closing balance the operators themselves recorded — a cross-check on
   * derived stock (design D5), never a second source of truth.
   */
  recordedClosingBalance: ['Qtd. final'],
  cost: ['Custo', 'Custo unitário', 'Preço de custo'],
  /**
   * The operation's own store, from the restocking export's header block
   * (design D2). Read here rather than positionally, same as every other
   * column, since the header block shares this module's column-matching.
   */
  clientStore: ['Cliente'],
  operationKind: ['Tipo de operação'],
  /**
   * When this operation finished. The same store and SKU can appear in
   * several operations within one month, each with its own `Qtd. final` — this
   * is what lets the latest one be picked as the month's recorded closing
   * balance, rather than an arbitrary earlier reading (design D5).
   */
  finishedAt: ['Finalizado em'],
} as const

export type ColumnKey = keyof typeof COLUMN_ALIASES

/**
 * Replicates `@app/sheeter`'s own header transformation exactly, so the
 * slugified lookup table matches what `smartChunk` actually produces as row
 * keys. Diverging from this — even slightly — would make every alias below it
 * silently never match.
 */
function slugifyLikeSheeter(text: string): string {
  return slugify(text, {
    replacement: '_',
    lower: false,
    remove: /[*+~.()'"!:@/|[\]{}]/g,
  })
}

type AliasTable = Record<ColumnKey, string[]>

function buildAliasTable(transform: (raw: string) => string): AliasTable {
  const table = {} as AliasTable

  for (const key of Object.keys(COLUMN_ALIASES) as ColumnKey[]) {
    table[key] = COLUMN_ALIASES[key].map(alias => normalizeReasonText(transform(alias)))
  }

  return table
}

/** For headers read directly from a workbook — not through `smartChunk`. */
const RAW_ALIASES = buildAliasTable(raw => raw)

/** For `smartChunk` row-object keys, which have already been slugified. */
const SLUGIFIED_ALIASES = buildAliasTable(slugifyLikeSheeter)

/**
 * Reads a value from a `smartChunk` row object by any of a column's accepted
 * header names, matching against the slugified alias table.
 */
export function readColumn(row: Record<string, unknown>, key: ColumnKey): unknown {
  const folded = new Map(Object.entries(row).map(([header, value]) => [normalizeReasonText(header), value]))

  for (const alias of SLUGIFIED_ALIASES[key]) {
    const value = folded.get(alias)
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }

  return undefined
}

/** Checks a `smartChunk` row object's headers, matching against the slugified alias table. */
export function hasColumn(headers: string[], key: ColumnKey): boolean {
  const folded = headers.map(normalizeReasonText)
  return SLUGIFIED_ALIASES[key].some(alias => folded.includes(alias))
}

/**
 * Reads a value from a raw workbook row — read directly via ExcelJS, before
 * `smartChunk` — by any of a column's accepted header names.
 */
export function readRawColumn(row: Record<string, unknown>, key: ColumnKey): unknown {
  const folded = new Map(Object.entries(row).map(([header, value]) => [normalizeReasonText(header), value]))

  for (const alias of RAW_ALIASES[key]) {
    const value = folded.get(alias)
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }

  return undefined
}

/** Checks raw workbook headers — read directly via ExcelJS — for a column. */
export function hasRawColumn(headers: string[], key: ColumnKey): boolean {
  const folded = headers.map(normalizeReasonText)
  return RAW_ALIASES[key].some(alias => folded.includes(alias))
}

/**
 * Finds which row (0-based) within a window carries a given column, searching
 * rather than assuming a fixed position — the export's product-table header
 * has been observed at the same row across every sample, but this is what
 * makes that a measured fact the code confirms rather than a number it
 * hardcodes. See design D1's "locate, don't assume" and report-layout's
 * "Restocking workbook layout" requirement.
 */
export function locateRawHeaderRow(rows: unknown[][], key: ColumnKey, searchWindow = 10): number | null {
  for (let i = 0; i < Math.min(rows.length, searchWindow); i++) {
    const headers = (rows[i] ?? []).map(value => String(value ?? ''))
    if (hasRawColumn(headers, key)) return i
  }

  return null
}

/**
 * Reads a monetary value into integer minor units.
 *
 * Accepts the Brazilian decimal comma the exports use. Rounds once, here, at
 * the boundary — everything downstream is integer arithmetic, which is what
 * keeps totals exact across thousands of rows.
 */
export function toCents(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null

  const raw = String(value)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.')

  // Stripping non-numeric characters from something like "abc" leaves an empty
  // string, and Number('') is 0 — an unreadable value would become a silent
  // zero, which is precisely the failure this platform is built to avoid.
  if (!/\d/.test(raw)) return null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return null

  return Math.round(parsed * 100)
}

/**
 * Reads a value as an integer quantity. Signed by design: `Diferença` and
 * `Remoções` are legitimately negative in the real export, and clamping or
 * rejecting a negative here would corrupt the balance-identity arithmetic
 * that depends on the sign surviving intact.
 */
/**
 * Reads an Excel serial date (days since 1899-12-30, the spreadsheet epoch —
 * offset to reproduce Excel's own leap-year bug so real dates round-trip) into
 * a JS Date. ExcelJS gives some date cells back as real `Date` objects already
 * and others as the raw serial number depending on the cell's format, so both
 * are accepted.
 */
export function toExcelDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value !== 'number' || !Number.isFinite(value)) return null

  const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
  const MS_PER_DAY = 86_400_000

  return new Date(EXCEL_EPOCH_MS + value * MS_PER_DAY)
}

export function toQuantity(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null

  const cleaned = String(value).replace(/[^\d.-]/g, '')
  // Same trap as toCents: an unreadable quantity must not become zero.
  if (!/\d/.test(cleaned)) return null

  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return null

  return Math.trunc(parsed)
}

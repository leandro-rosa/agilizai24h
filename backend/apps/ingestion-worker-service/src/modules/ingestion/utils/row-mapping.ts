import { normalizeReasonText } from './parse-removal-reasons'

/**
 * The reports come from a Portuguese-language POS export, so headers are
 * matched by their Portuguese names — folded the same way product names are, so
 * "Produto", "PRODUTO" and "produto " are the same column.
 *
 * Kept as a lookup rather than fixed column positions: the exports are not
 * guaranteed to keep column order, and a positional read would silently pick up
 * the wrong column rather than failing.
 */
export const COLUMN_ALIASES = {
  product: ['produto', 'descricao', 'item'],
  quantity: ['quantidade', 'qtd', 'quantidade vendida'],
  amount: ['valor', 'valor total', 'receita'],
  restocked: ['abastecido', 'quantidade abastecida', 'reposicao'],
  removals: ['remocoes', 'remocao', 'retiradas'],
  removedTotal: ['removido', 'quantidade removida', 'total removido'],
  cost: ['custo', 'custo unitario', 'preco de custo'],
} as const

export type ColumnKey = keyof typeof COLUMN_ALIASES

/** Reads a value by any of a column's accepted header names. */
export function readColumn(row: Record<string, unknown>, key: ColumnKey): unknown {
  const folded = new Map(Object.entries(row).map(([header, value]) => [normalizeReasonText(header), value]))

  for (const alias of COLUMN_ALIASES[key]) {
    const value = folded.get(alias)
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }

  return undefined
}

export function hasColumn(headers: string[], key: ColumnKey): boolean {
  const folded = headers.map(normalizeReasonText)
  return COLUMN_ALIASES[key].some(alias => folded.includes(alias))
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

export function toQuantity(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null

  const cleaned = String(value).replace(/[^\d.-]/g, '')
  // Same trap as toCents: an unreadable quantity must not become zero.
  if (!/\d/.test(cleaned)) return null

  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return null

  return Math.trunc(parsed)
}

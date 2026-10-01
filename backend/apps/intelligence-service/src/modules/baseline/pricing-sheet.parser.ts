/**
 * Reads the pricing sheet ("precificação") rows the owner maintains, taking only
 * what this service needs: the SKU, the baseline quantity ("qtd itens por loja")
 * and the packaging ("Medida"). Nothing is guessed:
 *
 * - a SKU that appears twice with the SAME values collapses to one;
 * - a SKU that appears twice with DIFFERENT values is a conflict, reported and
 *   NOT imported, unless the owner states the resolution explicitly;
 * - a row that cannot be read is rejected with its reason, never defaulted.
 */
export type Measure = 'unidade' | 'caixa' | 'fardo'

export const MEASURES: readonly Measure[] = ['unidade', 'caixa', 'fardo']

export interface SheetRow {
  SKU?: unknown
  'qtd itens por loja'?: unknown
  Medida?: unknown
  Produto?: unknown
}

export interface AcceptedItem {
  sku: string
  quantity: number
  measure: Measure
  product: string | null
}

export interface RejectedRow {
  /** 1-based position among the rows given, for finding it in the sheet. */
  row: number
  sku: string | null
  reason: 'invalid_sku' | 'invalid_quantity' | 'unknown_measure'
  detail: string
}

export interface ConflictRow {
  row: number
  quantity: number
  measure: Measure
}

export interface Conflict {
  sku: string
  product: string | null
  rows: ConflictRow[]
}

export interface Resolution {
  /** The owner's explicit choice for a SKU whose rows disagree. */
  quantity?: number
  measure?: Measure
}

export interface ParseResult {
  accepted: AcceptedItem[]
  rejected: RejectedRow[]
  conflicts: Conflict[]
  /** Conflicts the owner resolved explicitly, with what was chosen — kept for the audit trail. */
  resolved: { sku: string; chosen: { quantity: number; measure: Measure }; rows: ConflictRow[] }[]
  /** Rows with no SKU at all (blank or error filler at the end of a sheet). Counted, not rejected. */
  ignoredBlank: number
  /** SKUs that appeared more than once with identical values. */
  collapsedDuplicates: string[]
}

/** `6024`, `6024.0` and `" 6024 "` are the same SKU; anything that is not a whole number is not. */
export function normalizeSku(value: unknown): string | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? String(value) : null
  if (typeof value !== 'string') return null

  const text = value.trim().replace(/\.0+$/, '')
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : null
}

function normalizeMeasure(value: unknown): Measure | null {
  if (typeof value !== 'string') return null
  const text = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

  return (MEASURES as readonly string[]).includes(text) ? (text as Measure) : null
}

function normalizeQuantity(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : value
  // A baseline of zero is not "a quantity to keep": reported for the owner to decide, never imported.
  return typeof number === 'number' && Number.isInteger(number) && number >= 1 ? number : null
}

const isBlank = (value: unknown): boolean => value === null || value === undefined || (typeof value === 'string' && value.trim() === '')

export function parsePricingSheet(rows: SheetRow[], resolutions: Record<string, Resolution> = {}): ParseResult {
  const rejected: RejectedRow[] = []
  const bySku = new Map<string, { product: string | null; entries: { row: number; quantity: number; measure: Measure }[] }>()
  let ignoredBlank = 0

  rows.forEach((raw, index) => {
    const row = index + 1

    // A sheet often ends in filler (blank or "#ERROR!" cells) with no SKU: counted, not an error of any product.
    if (isBlank(raw.SKU)) {
      ignoredBlank++
      return
    }

    const sku = normalizeSku(raw.SKU)
    if (sku === null) {
      rejected.push({ row, sku: null, reason: 'invalid_sku', detail: `SKU "${String(raw.SKU)}" is not a whole number` })
      return
    }

    const quantity = normalizeQuantity(raw['qtd itens por loja'])
    if (quantity === null) {
      rejected.push({ row, sku, reason: 'invalid_quantity', detail: `"qtd itens por loja" is "${String(raw['qtd itens por loja'])}", expected a whole number of at least 1` })
      return
    }

    const measure = normalizeMeasure(raw.Medida)
    if (measure === null) {
      rejected.push({ row, sku, reason: 'unknown_measure', detail: `Medida is "${String(raw.Medida)}", expected one of ${MEASURES.join(', ')}` })
      return
    }

    const product = typeof raw.Produto === 'string' ? raw.Produto.trim() : null
    const slot = bySku.get(sku) ?? { product, entries: [] }
    slot.entries.push({ row, quantity, measure })
    bySku.set(sku, slot)
  })

  const accepted: AcceptedItem[] = []
  const conflicts: Conflict[] = []
  const resolved: ParseResult['resolved'] = []
  const collapsedDuplicates: string[] = []

  for (const [sku, { product, entries }] of bySku) {
    const distinct = new Set(entries.map(entry => `${entry.quantity}|${entry.measure}`))

    if (distinct.size === 1) {
      if (entries.length > 1) collapsedDuplicates.push(sku)
      accepted.push({ sku, quantity: entries[0].quantity, measure: entries[0].measure, product })
      continue
    }

    // The rows disagree. Only the owner can say which is right.
    const choice = resolutions[sku]
    const quantities = new Set(entries.map(entry => entry.quantity))
    const measures = new Set(entries.map(entry => entry.measure))
    const quantityOk = quantities.size === 1 || choice?.quantity !== undefined
    const measureOk = measures.size === 1 || choice?.measure !== undefined

    if (choice && quantityOk && measureOk && isValidChoice(choice, quantities, measures)) {
      const chosen = {
        quantity: quantities.size === 1 ? entries[0].quantity : (choice.quantity as number),
        measure: measures.size === 1 ? entries[0].measure : (choice.measure as Measure),
      }
      resolved.push({ sku, chosen, rows: entries })
      accepted.push({ sku, ...chosen, product })
      continue
    }

    conflicts.push({ sku, product, rows: entries })
  }

  return { accepted, rejected, conflicts, resolved, ignoredBlank, collapsedDuplicates }
}

/** A resolution must pick among the values the rows actually have — it is a choice, not a free edit. */
function isValidChoice(choice: Resolution, quantities: Set<number>, measures: Set<Measure>): boolean {
  if (choice.quantity !== undefined && !quantities.has(choice.quantity)) return false
  if (choice.measure !== undefined && !measures.has(choice.measure)) return false
  return true
}

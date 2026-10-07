import { EAN_STATUS } from '../constants/product-vocabulary'

/** EAN válido = só dígitos, 8 a 14. "7.89856E+12" (precisão perdida pelo Excel) não vale. */
export function cleanEan(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.trim()

  return /^\d{8,14}$/.test(digits) ? digits : null
}

/** A link between a product and an EAN, as much of it as resolution needs. */
export interface EanRow {
  product_id: number
  sku: string
  status: string
}

export type EanLookup<T extends EanRow = EanRow> =
  | { kind: 'active'; row: T }
  | { kind: 'historical'; row: T }
  | { kind: 'ambiguous'; rows: T[] }
  | { kind: 'unknown' }

/**
 * Who an EAN belongs to, from EVERY link that carries it. An active link wins (the database allows only one). With no
 * active link, a historical EAN that sits on exactly one product still resolves to it — an old invoice with the old
 * barcode feeds the same SKU — and is reported as historical. Historical on several products is ambiguous and is NOT
 * resolved: picking one would bind the figures to the wrong product. No link at all is unknown, and the caller must
 * report it, never create a product from it.
 */
export function lookupEan<T extends EanRow>(rows: T[]): EanLookup<T> {
  const active = rows.find(row => row.status === EAN_STATUS.ACTIVE)
  if (active) return { kind: 'active', row: active }

  const byProduct = new Map<number, T>()
  for (const row of rows) if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, row)

  if (byProduct.size === 0) return { kind: 'unknown' }
  if (byProduct.size === 1) return { kind: 'historical', row: [...byProduct.values()][0] }

  return { kind: 'ambiguous', rows: [...byProduct.values()] }
}

interface Linked {
  id: number
  ean: string
  status: string
  is_primary: boolean
}

/**
 * The EAN shown as "the" EAN of a product: the principal one; with none marked, the most recently added active one;
 * with no active one, none. An inactive EAN is never presented as the current barcode.
 */
export function principalOf<T extends Linked>(links: T[]): T | null {
  const primary = links.find(link => link.is_primary && link.status === EAN_STATUS.ACTIVE)
  if (primary) return primary

  const active = links.filter(link => link.status === EAN_STATUS.ACTIVE)

  return active.length === 0 ? null : active.reduce((latest, link) => (link.id > latest.id ? link : latest))
}

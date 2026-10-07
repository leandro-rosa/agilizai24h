import { principalOf } from './ean'

export interface ProductEanView {
  id: number
  ean: string
  status: string
  is_primary: boolean
  /** `YYYY-MM-DD`, or null when it was never recorded (the initial load has no start date to give). */
  valid_from: string | null
  valid_to: string | null
  source: string
  actor: string | null
  note: string | null
  created_at: string
}

export interface ProductView {
  id: number
  sku: string
  name: string
  category: string
  units_per_package: number | null
  package_type: string | null
  fractionable: boolean | null
  /** The principal EAN (or the latest active one); null when the product has no active EAN. Never an inactive one. */
  ean: string | null
  /** EVERY EAN the product ever had, with status and validity. An EAN is never deleted. */
  eans: ProductEanView[]
  /** Declared supplier (suppliers-service id), or null when none is registered. Never inferred. */
  supplier_id: number | null
  /** Populated by the ingestion pipeline, not by create()/update() here — read-only from this API. */
  shelf_life_days: number | null
  sale_unit: string
}

export interface EanRecord {
  id: number
  ean: string
  status: string
  is_primary: boolean
  valid_from: Date | null
  valid_to: Date | null
  source: string
  actor: string | null
  note: string | null
  created_at: Date
}

const day = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null)

export function toEanView(link: EanRecord): ProductEanView {
  return {
    id: link.id,
    ean: link.ean,
    status: link.status,
    is_primary: link.is_primary,
    valid_from: day(link.valid_from),
    valid_to: day(link.valid_to),
    source: link.source,
    actor: link.actor,
    note: link.note,
    created_at: link.created_at.toISOString(),
  }
}

/** The shape every product read produces: the row plus ALL its EAN links (so `ean` and `eans` always agree). */
export function toProductView(product: {
  id: number
  sku: string
  name: string
  category: string
  units_per_package: number | null
  package_type: string | null
  fractionable: boolean | null
  supplier_id: number | null
  shelf_life_days: number | null
  sale_unit: string
  eans: EanRecord[]
}): ProductView {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    units_per_package: product.units_per_package,
    shelf_life_days: product.shelf_life_days,
    package_type: product.package_type,
    fractionable: product.fractionable,
    ean: principalOf(product.eans)?.ean ?? null,
    eans: product.eans.map(toEanView),
    supplier_id: product.supplier_id,
    sale_unit: product.sale_unit,
  }
}

import { PRODUCT_CATEGORY_VALUES, type ProductCategory } from '../constants/product-vocabulary'
import { cleanEan } from './ean'
import { normalizeName } from './normalize-name'

/** One spreadsheet row after the operator mapped its columns. Every value is optional text/number; blank means "not given". */
export interface ImportRow {
  /** 1-based line of the spreadsheet, so a problem points at the line. */
  row: number
  sku?: string | null
  name?: string | null
  category?: string | null
  subcategory?: string | null
  brand?: string | null
  ean?: string | null
  saleUnit?: string | null
  purchaseUnit?: string | null
  packageType?: string | null
  unitsPerPackage?: string | number | null
}

export interface ImportOptions {
  /** Off by default: an empty cell never erases an existing value. On, an empty cell clears that field of an existing product. */
  clearEmpty?: boolean
}

export interface ExistingProduct {
  id: number
  sku: string
  name: string
  category: string
  subcategory: string | null
  brand: string | null
  sale_unit: string
  purchase_unit: string | null
  package_type: string | null
  units_per_package: number | null
  /** Every EAN link of the product, active or not. */
  eans: { ean: string; status: string; is_primary: boolean }[]
}

/** Who holds an EAN already (any product), so a conflict names the owner. */
export type EanOwners = Map<string, { sku: string; status: string }[]>

export type ImportAction = 'create' | 'update' | 'unchanged' | 'conflict'

export interface FieldChange {
  field: string
  from: string | number | null
  to: string | number | null
}

export interface ImportRowResult {
  row: number
  sku: string | null
  action: ImportAction
  /** What the row changes (update) or sets (create). */
  changes: FieldChange[]
  /** Fields an update would erase because the cell is empty and clearing was asked for. Never filled without `clearEmpty`. */
  clears: string[]
  /** An EAN the row adds to the product. */
  addEan: string | null
  problems: string[]
  /** The values a create or update applies, normalised. */
  values: NormalisedValues | null
}

export interface NormalisedValues {
  sku: string
  name?: string
  category?: ProductCategory
  subcategory?: string | null
  brand?: string | null
  saleUnit?: string
  purchaseUnit?: string | null
  packageType?: string | null
  unitsPerPackage?: number | null
  ean?: string
}

const CATEGORY_ALIASES: Record<string, ProductCategory> = {
  refeicao: 'meal', marmita: 'meal', 'refeicao / marmita': 'meal', meal: 'meal',
  lanche: 'snack', snack: 'snack',
  bebida: 'beverage', bebidas: 'beverage', beverage: 'beverage',
  essencial: 'essential', essenciais: 'essential', mercearia: 'essential', 'mercearia / essenciais': 'essential', essential: 'essential',
}

const blank = (value: unknown): boolean => value === undefined || value === null || String(value).trim() === ''
const text = (value: unknown): string | null => (blank(value) ? null : String(value).trim())

/** Category by its key or its Portuguese label, folded; unknown is a problem, never a guess. */
export function parseCategory(value: unknown): ProductCategory | null {
  const raw = text(value)
  if (!raw) return null
  const key = normalizeName(raw)

  return CATEGORY_ALIASES[key] ?? ((PRODUCT_CATEGORY_VALUES as readonly string[]).includes(key) ? (key as ProductCategory) : null)
}

/**
 * Classifies every row against the registry, writing nothing. SKU is the key. Rules: a row without SKU, a SKU repeated in the file, an unknown
 * category, an invalid EAN or one that belongs to another product (or to another row) is a CONFLICT and is not applied; a new product needs name and
 * category; an empty cell never erases a value unless `clearEmpty`; nothing is ever deleted. An EAN not yet on an existing product is ADDED to it.
 */
export function classifyImport(rows: ImportRow[], existing: ExistingProduct[], owners: EanOwners, options: ImportOptions = {}): ImportRowResult[] {
  const bySku = new Map(existing.map(product => [product.sku, product]))
  const firstRowOfSku = new Map<string, number>()
  const firstRowOfEan = new Map<string, number>()

  return rows.map(row => {
    const problems: string[] = []
    const sku = text(row.sku)
    const result = (action: ImportAction, extra: Partial<ImportRowResult> = {}): ImportRowResult => ({ row: row.row, sku, action, changes: [], clears: [], addEan: null, problems, values: null, ...extra })

    if (!sku) return (problems.push('Linha sem SKU'), result('conflict'))
    if (firstRowOfSku.has(sku)) return (problems.push(`SKU repetido na planilha (já na linha ${firstRowOfSku.get(sku)})`), result('conflict'))
    firstRowOfSku.set(sku, row.row)

    const values: NormalisedValues = { sku }
    const name = text(row.name)
    if (name) values.name = name
    if (!blank(row.category)) {
      const category = parseCategory(row.category)
      if (!category) problems.push(`Categoria desconhecida: "${text(row.category)}"`)
      else values.category = category
    }
    if (!blank(row.unitsPerPackage)) {
      const units = Number(String(row.unitsPerPackage).replace(',', '.'))
      if (!Number.isInteger(units) || units < 1) problems.push(`Unidades por embalagem inválidas: "${text(row.unitsPerPackage)}"`)
      else values.unitsPerPackage = units
    }
    for (const [field, key] of [['subcategory', 'subcategory'], ['brand', 'brand'], ['packageType', 'packageType'], ['purchaseUnit', 'purchaseUnit']] as const) {
      const value = text(row[field])
      if (value) values[key] = value
    }
    const saleUnit = text(row.saleUnit)
    if (saleUnit) values.saleUnit = saleUnit

    let ean: string | null = null
    if (!blank(row.ean)) {
      ean = cleanEan(String(row.ean))
      if (!ean) problems.push(`EAN inválido: "${text(row.ean)}" (use só dígitos, de 8 a 14; o Excel pode ter arredondado)`)
      else if (firstRowOfEan.has(ean) && firstRowOfEan.get(ean) !== row.row) problems.push(`O EAN ${ean} aparece em outra linha (${firstRowOfEan.get(ean)})`)
      else firstRowOfEan.set(ean, row.row)
    }

    const current = bySku.get(sku)
    const holders = ean ? (owners.get(ean) ?? []) : []

    if (!current) {
      if (!values.name) problems.push('Produto novo precisa de nome')
      if (!values.category) problems.push('Produto novo precisa de categoria')
      if (ean && holders.length > 0) problems.push(`O EAN ${ean} já pertence ao produto ${holders[0].sku}`)
      if (problems.length > 0) return result('conflict')
      if (ean) values.ean = ean

      return result('create', { values, changes: (Object.entries(values) as [string, string | number][]).filter(([field]) => field !== 'sku').map(([field, to]) => ({ field, from: null, to })) })
    }

    // Existing product: only fields the row actually gives, and only those that differ.
    const changes: FieldChange[] = []
    const compare = (field: string, from: string | number | null, to: string | number | null | undefined) => {
      if (to !== undefined && to !== null && to !== from) changes.push({ field, from, to })
    }
    compare('name', current.name, values.name)
    compare('category', current.category, values.category)
    compare('subcategory', current.subcategory, values.subcategory)
    compare('brand', current.brand, values.brand)
    compare('saleUnit', current.sale_unit, values.saleUnit)
    compare('purchaseUnit', current.purchase_unit, values.purchaseUnit)
    compare('packageType', current.package_type, values.packageType)
    compare('unitsPerPackage', current.units_per_package, values.unitsPerPackage)

    const clears: string[] = []
    if (options.clearEmpty) {
      for (const [field, key, now] of [['subcategory', 'subcategory', current.subcategory], ['brand', 'brand', current.brand], ['purchaseUnit', 'purchaseUnit', current.purchase_unit], ['packageType', 'packageType', current.package_type], ['unitsPerPackage', 'unitsPerPackage', current.units_per_package]] as const) {
        if (blank(row[key === 'unitsPerPackage' ? 'unitsPerPackage' : key]) && now !== null) clears.push(field)
      }
    }

    let addEan: string | null = null
    if (ean) {
      const own = current.eans.find(link => link.ean === ean)
      const elsewhere = holders.filter(holder => holder.sku !== sku && holder.status === 'active')
      if (elsewhere.length > 0) problems.push(`O EAN ${ean} está ativo no produto ${elsewhere[0].sku}`)
      else if (own && own.status === 'inactive') problems.push(`O EAN ${ean} já foi deste produto e está inativo: reative-o na tela do produto`)
      else if (!own) addEan = ean
    }

    if (problems.length > 0) return result('conflict')
    if (changes.length === 0 && clears.length === 0 && addEan === null) return result('unchanged')

    return result('update', { values, changes, clears, addEan })
  })
}

export function summarise(results: ImportRowResult[]): Record<ImportAction, number> {
  const count: Record<ImportAction, number> = { create: 0, update: 0, unchanged: 0, conflict: 0 }
  for (const result of results) count[result.action] += 1

  return count
}

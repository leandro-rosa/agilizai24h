import { classifyName, type TaxonomyCategory } from './classify'
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
  /** A person saved this classification: an import does not change it. */
  classification_confirmed?: boolean
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
  /** What the import did NOT do and why (e.g. kept a confirmed classification). Not a conflict: the rest of the row applies. */
  notes: string[]
  /** Where the category came from: given by the row, or suggested from the name. */
  classification: 'given' | 'suggested' | null
  /** The values a create or update applies, normalised. */
  values: NormalisedValues | null
}

export interface NormalisedValues {
  sku: string
  name?: string
  category?: string
  subcategory?: string | null
  brand?: string | null
  saleUnit?: string
  purchaseUnit?: string | null
  packageType?: string | null
  unitsPerPackage?: number | null
  ean?: string
}

/** Names the old spreadsheets used for the four starting categories; they only count when that category exists (and is active) in the taxonomy. */
const LEGACY_ALIASES: Record<string, string> = {
  refeicao: 'meal', marmita: 'meal', 'refeicao / marmita': 'meal',
  lanche: 'snack',
  bebida: 'beverage', bebidas: 'beverage',
  essencial: 'essential', essenciais: 'essential', mercearia: 'essential', 'mercearia / essenciais': 'essential',
}

const blank = (value: unknown): boolean => value === undefined || value === null || String(value).trim() === ''
const text = (value: unknown): string | null => (blank(value) ? null : String(value).trim())

/** A category by its key or its name in the taxonomy, folded; unknown is a problem, never a guess and never a new category. */
export function parseCategory(value: unknown, taxonomy: TaxonomyCategory[]): string | null {
  const raw = text(value)
  if (!raw) return null
  const folded = normalizeName(raw)
  const direct = taxonomy.find(category => category.key === folded || normalizeName(category.name) === folded)
  if (direct) return direct.key
  const legacy = LEGACY_ALIASES[folded]

  return legacy && taxonomy.some(category => category.key === legacy) ? legacy : null
}

/**
 * Classifies every row against the registry, writing nothing. SKU is the key. Rules: a row without SKU, a SKU repeated in the file, an unknown
 * category, an invalid EAN or one that belongs to another product (or to another row) is a CONFLICT and is not applied; a new product needs name and
 * category; an empty cell never erases a value unless `clearEmpty`; nothing is ever deleted. An EAN not yet on an existing product is ADDED to it.
 */
export function classifyImport(rows: ImportRow[], existing: ExistingProduct[], owners: EanOwners, options: ImportOptions = {}, taxonomy: TaxonomyCategory[] = []): ImportRowResult[] {
  const bySku = new Map(existing.map(product => [product.sku, product]))
  const firstRowOfSku = new Map<string, number>()
  const firstRowOfEan = new Map<string, number>()

  return rows.map(row => {
    const problems: string[] = []
    const sku = text(row.sku)
    const notes: string[] = []
    let classification: ImportRowResult['classification'] = null
    const result = (action: ImportAction, extra: Partial<ImportRowResult> = {}): ImportRowResult => ({ row: row.row, sku, action, changes: [], clears: [], addEan: null, problems, notes, classification, values: null, ...extra })

    if (!sku) return (problems.push('Linha sem SKU'), result('conflict'))
    if (firstRowOfSku.has(sku)) return (problems.push(`SKU repetido na planilha (já na linha ${firstRowOfSku.get(sku)})`), result('conflict'))
    firstRowOfSku.set(sku, row.row)

    const values: NormalisedValues = { sku }
    const name = text(row.name)
    if (name) values.name = name
    if (!blank(row.category)) {
      const category = parseCategory(row.category, taxonomy)
      if (!category) problems.push(`Categoria desconhecida: "${text(row.category)}" (as categorias são as do cadastro de categorias; nenhuma é criada pela planilha)`)
      else {
        values.category = category
        classification = 'given'
      }
    }
    if (!blank(row.unitsPerPackage)) {
      const units = Number(String(row.unitsPerPackage).replace(',', '.'))
      if (!Number.isInteger(units) || units < 1) problems.push(`Unidades por embalagem inválidas: "${text(row.unitsPerPackage)}"`)
      else values.unitsPerPackage = units
    }
    for (const [field, key] of [['brand', 'brand'], ['packageType', 'packageType'], ['purchaseUnit', 'purchaseUnit']] as const) {
      const value = text(row[field])
      if (value) values[key] = value
    }
    const saleUnit = text(row.saleUnit)
    if (saleUnit) values.saleUnit = saleUnit
    const givenSubcategory = text(row.subcategory)

    let ean: string | null = null
    if (!blank(row.ean)) {
      ean = cleanEan(String(row.ean))
      if (!ean) problems.push(`EAN inválido: "${text(row.ean)}" (use só dígitos, de 8 a 14; o Excel pode ter arredondado)`)
      else if (firstRowOfEan.has(ean) && firstRowOfEan.get(ean) !== row.row) problems.push(`O EAN ${ean} aparece em outra linha (${firstRowOfEan.get(ean)})`)
      else firstRowOfEan.set(ean, row.row)
    }

    const current = bySku.get(sku)
    const holders = ean ? (owners.get(ean) ?? []) : []

    // Applies a subcategory text to a category: it must belong to it (ignoring case and accents); the canonical spelling is what is applied.
    const subcategoryOf = (categoryKey: string, wanted: string): string | null => {
      const sub = taxonomy.find(category => category.key === categoryKey)?.subcategories.find(candidate => normalizeName(candidate.name) === normalizeName(wanted))

      return sub ? sub.name : null
    }

    if (!current) {
      if (!values.name) problems.push('Produto novo precisa de nome')
      // No category given: the name classifies it, only when it is clear; ambiguous or unknown stays a conflict (never a guess, never a new category).
      if (!values.category && values.name && blank(row.category)) {
        const guess = classifyName(values.name, taxonomy)
        if (guess.confidence === 'clear' && guess.best) {
          values.category = guess.best.categoryKey
          classification = 'suggested'
          if (!givenSubcategory && guess.best.subcategory) values.subcategory = guess.best.subcategory
        } else if (guess.confidence === 'ambiguous') problems.push(`Categoria não informada e o nome é ambíguo (${guess.alternatives.map(a => `${a.categoryName}${a.subcategory ? ` > ${a.subcategory}` : ''}`).join(' ou ')}): informe a categoria`)
      }
      if (!values.category && !problems.some(problem => problem.startsWith('Categoria'))) problems.push('Produto novo precisa de categoria')
      if (values.category && givenSubcategory) {
        const sub = subcategoryOf(values.category, givenSubcategory)
        if (sub) values.subcategory = sub
        else problems.push(`A subcategoria "${givenSubcategory}" não pertence à categoria escolhida`)
      }
      if (ean && holders.length > 0) problems.push(`O EAN ${ean} já pertence ao produto ${holders[0].sku}`)
      if (problems.length > 0) return result('conflict')
      if (ean) values.ean = ean

      return result('create', { values, changes: (Object.entries(values) as [string, string | number][]).filter(([field]) => field !== 'sku').map(([field, to]) => ({ field, from: null, to })) })
    }

    // Existing product: only fields the row actually gives, and only those that differ. A classification a person confirmed is kept.
    if (current.classification_confirmed && (values.category !== undefined || givenSubcategory)) {
      const differs = (values.category !== undefined && values.category !== current.category) || (givenSubcategory && normalizeName(givenSubcategory) !== normalizeName(current.subcategory ?? ''))
      if (differs) notes.push('Classificação já confirmada por uma pessoa: categoria e subcategoria da planilha não foram aplicadas')
      delete values.category
      delete values.subcategory
    } else if (values.category !== undefined || givenSubcategory) {
      const target = values.category ?? current.category
      if (givenSubcategory) {
        const sub = subcategoryOf(target, givenSubcategory)
        if (sub) values.subcategory = sub
        else problems.push(`A subcategoria "${givenSubcategory}" não pertence à categoria ${taxonomy.find(c => c.key === target)?.name ?? target}`)
      }
    }
    const changes: FieldChange[] = []
    const compare = (field: string, from: string | number | null, to: string | number | null | undefined) => {
      if (to !== undefined && to !== null && to !== from) changes.push({ field, from, to })
    }
    compare('name', current.name, values.name)
    compare('category', current.category, values.category)
    compare('subcategory', current.subcategory, current.classification_confirmed ? undefined : values.subcategory)
    compare('brand', current.brand, values.brand)
    compare('saleUnit', current.sale_unit, values.saleUnit)
    compare('purchaseUnit', current.purchase_unit, values.purchaseUnit)
    compare('packageType', current.package_type, values.packageType)
    compare('unitsPerPackage', current.units_per_package, values.unitsPerPackage)

    const clears: string[] = []
    if (options.clearEmpty) {
      for (const [field, key, now] of [['subcategory', 'subcategory', current.subcategory], ['brand', 'brand', current.brand], ['purchaseUnit', 'purchaseUnit', current.purchase_unit], ['packageType', 'packageType', current.package_type], ['unitsPerPackage', 'unitsPerPackage', current.units_per_package]] as const) {
        if (blank(row[key]) && now !== null && !(key === 'subcategory' && current.classification_confirmed)) clears.push(field)
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

import { classifyImport, parseCategory, summarise, type ExistingProduct, type ImportRow } from './catalogue-import'
import type { TaxonomyCategory } from './classify'

const taxonomy: TaxonomyCategory[] = [
  { key: 'beverage', name: 'Bebida', keywords: ['bebida', 'suco'], subcategories: [{ id: 1, name: 'Energéticos', keywords: ['energetico', 'monster'] }, { id: 2, name: 'Refrigerantes', keywords: ['guarana', 'refrigerante'] }, { id: 3, name: 'Chás', keywords: ['cha'] }] },
  { key: 'snack', name: 'Lanche', keywords: ['lanche'], subcategories: [{ id: 4, name: 'Chocolates', keywords: ['chocolate'] }] },
  { key: 'meal', name: 'Refeição', keywords: ['marmita'], subcategories: [] },
  { key: 'essential', name: 'Essencial', keywords: [], subcategories: [] },
]

const product = (over: Partial<ExistingProduct> = {}): ExistingProduct => ({
  id: 1, sku: '110001', name: 'Água com gás', category: 'beverage', subcategory: 'Águas', brand: 'Crystal', sale_unit: 'un', purchase_unit: 'CX', package_type: 'caixa', units_per_package: 12,
  eans: [{ ean: '7891000000001', status: 'active', is_primary: true }], ...over,
})
const row = (over: Partial<ImportRow> = {}): ImportRow => ({ row: 2, sku: '110099', name: 'Novo', category: 'Bebida', ...over })
const classify = (rows: ImportRow[], existing: ExistingProduct[] = [product()], owners = new Map<string, { sku: string; status: string }[]>([['7891000000001', [{ sku: '110001', status: 'active' }]]]), options = {}) => classifyImport(rows, existing, owners, options, taxonomy)

describe('parseCategory', () => {
  it('accepts the key or the Portuguese label, folded; never guesses', () => {
    expect(parseCategory('Bebida', taxonomy)).toBe('beverage')
    expect(parseCategory('refeição / marmita', taxonomy)).toBe('meal')
    expect(parseCategory('MERCEARIA', taxonomy)).toBe('essential')
    expect(parseCategory('snack', taxonomy)).toBe('snack')
    expect(parseCategory('doces', taxonomy)).toBeNull()
    expect(parseCategory('', taxonomy)).toBeNull()
    // An old alias only counts while its category exists in the taxonomy.
    expect(parseCategory('Mercearia', taxonomy.filter(c => c.key !== 'essential'))).toBeNull()
  })
})

describe('classifyImport — new products', () => {
  it('creates a product with name and category, normalising the category', () => {
    const [result] = classify([row({ ean: '7891000000999', unitsPerPackage: '6', brand: 'Monster' })])

    expect(result.action).toBe('create')
    expect(result.values).toMatchObject({ sku: '110099', name: 'Novo', category: 'beverage', brand: 'Monster', unitsPerPackage: 6, ean: '7891000000999' })
  })

  it('a new product without name or category is a conflict that says what is missing', () => {
    const [result] = classify([row({ name: '', category: '' })])

    expect(result.action).toBe('conflict')
    expect(result.problems).toEqual(['Produto novo precisa de nome', 'Produto novo precisa de categoria'])
  })

  it('an EAN that already belongs to another product is a conflict naming it, even a historical one', () => {
    const [active] = classify([row({ ean: '7891000000001' })])
    const [historical] = classify([row({ ean: '7890000000009' })], [product()], new Map([['7890000000009', [{ sku: '110050', status: 'inactive' }]]]))

    expect(active.problems).toEqual(['O EAN 7891000000001 já pertence ao produto 110001'])
    expect(historical.action).toBe('conflict')
  })
})

describe('classifyImport — rows that are wrong', () => {
  it('a row without SKU, a SKU repeated in the file, a repeated EAN, a bad EAN and a bad category are conflicts', () => {
    const results = classify([
      row({ row: 2, sku: '' }),
      row({ row: 3, sku: '110010', ean: '7891000000777' }),
      row({ row: 4, sku: '110010' }),
      row({ row: 5, sku: '110011', ean: '7891000000777' }),
      row({ row: 6, sku: '110012', ean: '7.89E+12' }),
      row({ row: 7, sku: '110013', category: 'doces' }),
      row({ row: 8, sku: '110014', unitsPerPackage: 'abc' }),
    ])

    expect(results.map(r => r.action)).toEqual(['conflict', 'create', 'conflict', 'conflict', 'conflict', 'conflict', 'conflict'])
    expect(results[0].problems).toEqual(['Linha sem SKU'])
    expect(results[2].problems[0]).toContain('SKU repetido na planilha (já na linha 3)')
    expect(results[3].problems[0]).toContain('aparece em outra linha (3)')
    expect(results[4].problems[0]).toContain('EAN inválido')
    expect(results[5].problems[0]).toContain('Categoria desconhecida')
    expect(results[6].problems[0]).toContain('Unidades por embalagem inválidas')
  })
})

describe('classifyImport — existing products', () => {
  it('lists only the fields that differ', () => {
    const [result] = classify([{ row: 2, sku: '110001', name: 'Água com gás 500ml', brand: 'Crystal', category: 'Bebida' }])

    expect(result.action).toBe('update')
    expect(result.changes).toEqual([{ field: 'name', from: 'Água com gás', to: 'Água com gás 500ml' }])
  })

  it('an empty cell keeps the existing value: nothing to update', () => {
    const [result] = classify([{ row: 2, sku: '110001', name: '', subcategory: '', brand: '', unitsPerPackage: '' }])

    expect(result.action).toBe('unchanged')
    expect(result.clears).toEqual([])
  })

  it('only with the clearing option does an empty cell clear a field, and the preview lists what it would clear', () => {
    const [result] = classify([{ row: 2, sku: '110001', name: 'Água com gás', subcategory: '', brand: 'Crystal' }], [product()], new Map(), { clearEmpty: true })

    expect(result.action).toBe('update')
    expect(result.clears.sort()).toEqual(['packageType', 'purchaseUnit', 'subcategory', 'unitsPerPackage'])
  })

  it('a new EAN is added to the product; its own EAN is not a change; one active elsewhere is a conflict; an inactive own one points to reactivation', () => {
    const owners = new Map([
      ['7891000000001', [{ sku: '110001', status: 'active' }]],
      ['7891000000002', [{ sku: '110002', status: 'active' }]],
      ['7890000000003', [{ sku: '110001', status: 'inactive' }]],
    ])
    const eans = [{ ean: '7891000000001', status: 'active', is_primary: true }, { ean: '7890000000003', status: 'inactive', is_primary: false }]
    const existing = [product({ sku: 'A', eans }), product({ id: 2, sku: 'B', eans }), product({ id: 3, sku: 'C', eans }), product({ id: 4, sku: 'D', eans })]
    const own = new Map([...owners].map(([ean, list]) => [ean, list.map(h => (h.sku === '110001' ? { ...h, sku: 'x' } : h))]))
    const [added, same, elsewhere, inactive] = classify(
      [{ row: 2, sku: 'A', ean: '7891000000555' }, { row: 3, sku: 'B', ean: '7891000000001' }, { row: 4, sku: 'C', ean: '7891000000002' }, { row: 5, sku: 'D', ean: '7890000000003' }],
      existing,
      new Map([['7891000000001', [{ sku: 'B', status: 'active' }]], ['7891000000002', own.get('7891000000002') ?? []], ['7890000000003', [{ sku: 'D', status: 'inactive' }]]]),
    )

    expect(added).toMatchObject({ action: 'update', addEan: '7891000000555' })
    expect(same.action).toBe('unchanged')
    expect(elsewhere.problems[0]).toContain('está ativo no produto 110002')
    expect(inactive.problems[0]).toContain('reative-o')
  })

  it('applying the same file twice finds nothing to do the second time', () => {
    const applied = product({ name: 'Água com gás 500ml', eans: [{ ean: '7891000000001', status: 'active', is_primary: true }, { ean: '7891000000555', status: 'active', is_primary: false }] })
    const [second] = classify([{ row: 2, sku: '110001', name: 'Água com gás 500ml', ean: '7891000000555' }], [applied], new Map([['7891000000555', [{ sku: '110001', status: 'active' }]]]))

    expect(second.action).toBe('unchanged')
  })
})

describe('summarise', () => {
  it('counts each action', () => {
    expect(summarise(classify([row(), { row: 3, sku: '110001' }, { row: 4, sku: '' }]))).toEqual({ create: 1, update: 0, unchanged: 1, conflict: 1 })
  })
})

describe('classifyImport — classification from the managed taxonomy', () => {
  it('a new product with no category is classified from its name when that is clear, and the row says it was suggested', () => {
    const [result] = classify([{ row: 2, sku: '110050', name: 'Monster Energy 269 ml' }])

    expect(result.action).toBe('create')
    expect(result.classification).toBe('suggested')
    expect(result.values).toMatchObject({ category: 'beverage', subcategory: 'Energéticos' })
  })

  it('an ambiguous name with no category is a conflict that lists the options; an unknown name is a conflict too; no category is ever created', () => {
    const [ambiguous, unknown] = classify([{ row: 2, sku: '110051', name: 'Chá com chocolate' }, { row: 3, sku: '110052', name: 'Cadeira de praia' }])

    expect(ambiguous.action).toBe('conflict')
    expect(ambiguous.problems[0]).toContain('ambíguo')
    expect(ambiguous.problems[0]).toContain('Bebida > Chás')
    expect(unknown.problems).toEqual(['Produto novo precisa de categoria'])
  })

  it('a category given by the row is used as given, not replaced by what the name would suggest', () => {
    const [result] = classify([{ row: 2, sku: '110053', name: 'Monster Energy', category: 'Lanche' }])

    expect(result.classification).toBe('given')
    expect(result.values).toMatchObject({ category: 'snack' })
    expect(result.values?.subcategory).toBeUndefined()
  })

  it('a category that is not in the taxonomy is a conflict and nothing is created for it', () => {
    const [result] = classify([{ row: 2, sku: '110054', name: 'Novo', category: 'Eletrônicos' }])

    expect(result.action).toBe('conflict')
    expect(result.problems[0]).toContain('Categoria desconhecida')
    expect(result.problems[0]).toContain('nenhuma é criada pela planilha')
  })

  it('the subcategory must belong to the category, in its canonical spelling', () => {
    const [good, bad] = classify([{ row: 2, sku: '110055', name: 'X', category: 'Bebida', subcategory: 'energeticos' }, { row: 3, sku: '110056', name: 'Y', category: 'Lanche', subcategory: 'Energéticos' }])

    expect(good.values).toMatchObject({ category: 'beverage', subcategory: 'Energéticos' })
    expect(bad.action).toBe('conflict')
    expect(bad.problems[0]).toContain('não pertence à categoria escolhida')
  })

  it('an existing product with a confirmed classification keeps it, and the row says so; the rest of the row still applies', () => {
    const [result] = classify([{ row: 2, sku: '110001', name: 'Água com gás 500ml', category: 'Lanche', subcategory: 'Chocolates' }], [product({ classification_confirmed: true })])

    expect(result.action).toBe('update')
    expect(result.changes.map(c => c.field)).toEqual(['name'])
    expect(result.values?.category).toBeUndefined()
    expect(result.values?.subcategory).toBeUndefined()
    expect(result.notes).toEqual(['Classificação já confirmada por uma pessoa: categoria e subcategoria da planilha não foram aplicadas'])
  })

  it('an unconfirmed product takes the new classification from the row', () => {
    const [result] = classify([{ row: 2, sku: '110001', category: 'Lanche', subcategory: 'Chocolates' }], [product({ classification_confirmed: false })])

    expect(result.changes).toEqual(expect.arrayContaining([{ field: 'category', from: 'beverage', to: 'snack' }, { field: 'subcategory', from: 'Águas', to: 'Chocolates' }]))
    expect(result.notes).toEqual([])
  })

  it('clearing empty cells never clears the subcategory of a confirmed classification', () => {
    const [result] = classify([{ row: 2, sku: '110001', name: 'Água com gás', subcategory: '' }], [product({ classification_confirmed: true })], new Map(), { clearEmpty: true })

    expect(result.clears).not.toContain('subcategory')
  })
})

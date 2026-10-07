import { classifyImport, parseCategory, summarise, type ExistingProduct, type ImportRow } from './catalogue-import'

const product = (over: Partial<ExistingProduct> = {}): ExistingProduct => ({
  id: 1, sku: '110001', name: 'Água com gás', category: 'beverage', subcategory: 'Águas', brand: 'Crystal', sale_unit: 'un', purchase_unit: 'CX', package_type: 'caixa', units_per_package: 12,
  eans: [{ ean: '7891000000001', status: 'active', is_primary: true }], ...over,
})
const row = (over: Partial<ImportRow> = {}): ImportRow => ({ row: 2, sku: '110099', name: 'Novo', category: 'Bebida', ...over })
const classify = (rows: ImportRow[], existing: ExistingProduct[] = [product()], owners = new Map<string, { sku: string; status: string }[]>([['7891000000001', [{ sku: '110001', status: 'active' }]]]), options = {}) => classifyImport(rows, existing, owners, options)

describe('parseCategory', () => {
  it('accepts the key or the Portuguese label, folded; never guesses', () => {
    expect(parseCategory('Bebida')).toBe('beverage')
    expect(parseCategory('refeição / marmita')).toBe('meal')
    expect(parseCategory('MERCEARIA')).toBe('essential')
    expect(parseCategory('snack')).toBe('snack')
    expect(parseCategory('doces')).toBeNull()
    expect(parseCategory('')).toBeNull()
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

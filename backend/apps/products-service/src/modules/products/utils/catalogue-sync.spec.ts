import { cleanEan, mapCategory, planSync, type CatalogueEntry, type SheetRow } from './catalogue-sync'

// Fixtures sintéticas, só neste spec.
const row = (over: Partial<SheetRow>): SheetRow => ({
  row: 2, sku: 'A', name: 'Produto A', category: 'Bebidas', subcategory: null, ean: null, supplier: null,
  cost_cents: 300, cost_error: false, price_cents: 790, package_type: 'fardo', ...over,
})
const cat = (over: Partial<CatalogueEntry>): CatalogueEntry => ({ sku: 'A', name: 'Produto A', ean: null, cost_cents: 300, price_cents: 790, ...over })

describe('mapCategory (convention of the existing 233 products)', () => {
  it.each([
    ['Bebidas', 'beverage'], ['Cafés', 'beverage'], ['Mercearia', 'essential'],
    ['Lanches e Snacks', 'snack'], ['Congelados', 'snack'], ['Marmitas', 'snack'], ['Doces', 'snack'], [null, 'snack'],
  ])('%s -> %s', (input, expected) => expect(mapCategory(input)).toBe(expected))
})

describe('cleanEan', () => {
  it('keeps a plain 13-digit EAN', () => expect(cleanEan('7898557010077')).toBe('7898557010077'))
  it('rejects scientific notation that Excel already rounded', () => expect(cleanEan('7.89856E+12')).toBeNull())
  it('rejects short or non-numeric', () => { expect(cleanEan('123')).toBeNull(); expect(cleanEan('abc')).toBeNull(); expect(cleanEan(null)).toBeNull() })
})

describe('planSync', () => {
  it('a SKU missing from the catalogue is created with mapped category and cost/price', () => {
    const plan = planSync([row({ sku: '100115', name: 'Irreal Snacks Tomate Seco 40G', category: 'Lanches e Snacks', cost_cents: 950, price_cents: 1690, package_type: 'Unidade' })], [])
    expect(plan.create).toEqual([expect.objectContaining({ sku: '100115', category: 'snack', cost_cents: 950, price_cents: 1690, package_type: 'unidade' })])
    expect(plan.costs).toEqual([])
  })

  it('an existing SKU only gets cost/price changes, never name/category/ean rewrites', () => {
    const plan = planSync([row({ name: 'NOME NOVO', category: 'Mercearia', cost_cents: 350, price_cents: 790 })], [cat({})])
    expect(plan.create).toEqual([])
    expect(plan.costs).toEqual([{ sku: 'A', name: 'Produto A', current_cents: 300, new_cents: 350, row: 2 }])
    expect(plan.prices).toEqual([])
  })

  it('identical cost and price count as unchanged', () => {
    const plan = planSync([row({})], [cat({})])
    expect(plan.unchanged).toBe(1)
    expect(plan.costs.concat(plan.prices)).toEqual([])
  })

  it('zero cost is applied but flagged (margin would read 100%)', () => {
    const plan = planSync([row({ sku: 'S', name: 'Sprite zero', cost_cents: 0 })], [])
    expect(plan.create[0].cost_cents).toBe(0)
    expect(plan.issues.map(i => i.code)).toContain('zero_cost')
  })

  it('a formula-error cost is never applied, for new or existing products', () => {
    const created = planSync([row({ sku: 'N', cost_cents: null, cost_error: true })], [])
    expect(created.create[0].cost_cents).toBeNull()
    const existing = planSync([row({ cost_cents: null, cost_error: true })], [cat({})])
    expect(existing.costs).toEqual([])
    expect(created.issues.concat(existing.issues).filter(i => i.code === 'cost_error')).toHaveLength(2)
  })

  it('trailing formula-only rows with no SKU and no name are ignored without noise', () => {
    const plan = planSync([row({ sku: '', name: '', cost_cents: null, cost_error: true })], [])
    expect(plan).toMatchObject({ create: [], issues: [] })
  })

  it('a duplicated SKU keeps the first row and says whether the copies disagree', () => {
    const same = planSync([row({ sku: 'D', row: 2 }), row({ sku: 'D', row: 9 })], [])
    expect(same.create).toHaveLength(1)
    expect(same.issues[0].code).toBe('duplicate_sku')
    const differ = planSync([row({ sku: 'D', row: 2, cost_cents: 100 }), row({ sku: 'D', row: 9, cost_cents: 200 })], [])
    expect(differ.create[0].cost_cents).toBe(100)
    expect(differ.issues[0].code).toBe('conflicting_duplicate')
  })

  it('an EAN already used by another SKU is dropped on the new one, not duplicated', () => {
    const plan = planSync(
      [row({ sku: 'N1', ean: '7896306625022' }), row({ sku: 'N2', ean: '7896306625022' })],
      [cat({ sku: 'OLD', ean: '7891000107836' })],
    )
    expect(plan.create.map(c => [c.sku, c.ean])).toEqual([['N1', '7896306625022'], ['N2', null]])
    expect(plan.issues.map(i => i.code)).toContain('ean_conflict')
    const vsCatalogue = planSync([row({ sku: 'N3', ean: '7891000107836' })], [cat({ sku: 'OLD', ean: '7891000107836' })])
    expect(vsCatalogue.create[0].ean).toBeNull()
  })

  it('a new product with no name is blocked, not invented', () => {
    const plan = planSync([row({ sku: 'X', name: '' })], [])
    expect(plan.create).toEqual([])
    expect(plan.issues).toEqual([expect.objectContaining({ severity: 'blocked', code: 'missing_name' })])
  })

  it('a blank category is defaulted to snack with a warning', () => {
    const plan = planSync([row({ sku: 'B', category: null })], [])
    expect(plan.create[0].category).toBe('snack')
    expect(plan.issues.map(i => i.code)).toContain('category_blank')
  })
})

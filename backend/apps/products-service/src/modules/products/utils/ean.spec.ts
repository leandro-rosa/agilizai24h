import { cleanEan, lookupEan, principalOf } from './ean'

const row = (product_id: number, status: string, sku = `SKU${product_id}`) => ({ product_id, sku, status })
const link = (id: number, status: string, is_primary = false) => ({ id, ean: `789000000000${id}`, status, is_primary })

describe('cleanEan', () => {
  it('keeps a plain EAN of 8 to 14 digits', () => {
    expect(cleanEan('7891000107836')).toBe('7891000107836')
    expect(cleanEan(' 78910001 ')).toBe('78910001')
  })

  it('rejects scientific notation, short, long and non-numeric values', () => {
    for (const bad of ['7.89856E+12', '123', '123456789012345', 'abc', '', null, undefined]) expect(cleanEan(bad as string | null)).toBeNull()
  })
})

describe('lookupEan', () => {
  it('an active link resolves to its product', () => {
    expect(lookupEan([row(1, 'active')])).toMatchObject({ kind: 'active', row: { sku: 'SKU1' } })
  })

  it('prefers the active link over a historical one of another product', () => {
    expect(lookupEan([row(1, 'inactive'), row(2, 'active')])).toMatchObject({ kind: 'active', row: { product_id: 2 } })
  })

  it('a historical EAN on exactly one product still resolves to that product, marked historical', () => {
    expect(lookupEan([row(1, 'inactive')])).toMatchObject({ kind: 'historical', row: { sku: 'SKU1' } })
  })

  it('a historical EAN on several products is ambiguous and is not resolved', () => {
    const result = lookupEan([row(1, 'inactive'), row(2, 'inactive')])

    expect(result.kind).toBe('ambiguous')
    expect(result.kind === 'ambiguous' && result.rows.map(r => r.sku)).toEqual(['SKU1', 'SKU2'])
  })

  it('the same product linked twice is one product, not ambiguity', () => {
    expect(lookupEan([row(1, 'inactive'), row(1, 'inactive')]).kind).toBe('historical')
  })

  it('no link is unknown', () => {
    expect(lookupEan([])).toEqual({ kind: 'unknown' })
  })
})

describe('principalOf', () => {
  it('is the principal active EAN', () => {
    expect(principalOf([link(1, 'active'), link(2, 'active', true), link(3, 'inactive')])?.id).toBe(2)
  })

  it('without a principal, the most recently added active one', () => {
    expect(principalOf([link(1, 'active'), link(4, 'active'), link(5, 'inactive')])?.id).toBe(4)
  })

  it('never presents an inactive EAN as the current one', () => {
    expect(principalOf([link(1, 'inactive')])).toBeNull()
    expect(principalOf([])).toBeNull()
  })
})

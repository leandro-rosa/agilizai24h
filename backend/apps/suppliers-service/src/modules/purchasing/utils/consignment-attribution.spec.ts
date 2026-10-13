import { attributeSale } from './consignment-attribution'

describe('attributeSale — which supplier a sale belongs to', () => {
  it('one supplier holds the SKU there → attributed (derived fact)', () => {
    expect(attributeSale([{ supplierId: 7, balance: 12 }])).toEqual({ supplierId: 7, basis: 'single', pending: false, suggestion: null })
  })

  it('suppliers with no sellable balance do not count as holders', () => {
    expect(attributeSale([{ supplierId: 7, balance: 12 }, { supplierId: 8, balance: 0 }, { supplierId: 9, balance: -3 }]).supplierId).toBe(7)
  })

  it('nobody holds the SKU → not ours and not pending (it came from stock that is not consigned)', () => {
    expect(attributeSale([])).toEqual({ supplierId: null, basis: 'none', pending: false, suggestion: null })
  })

  it('two or more holders → NOT attributed, pending, with the largest balance only as a suggestion', () => {
    expect(attributeSale([{ supplierId: 7, balance: 5 }, { supplierId: 8, balance: 9 }])).toEqual({ supplierId: null, basis: 'ambiguous', pending: true, suggestion: 8 })
  })

  it('holders are listed but none has sellable stock → pending (the stock data is wrong), never silently skipped', () => {
    expect(attributeSale([{ supplierId: 7, balance: 0 }])).toEqual({ supplierId: null, basis: 'no_stock', pending: true, suggestion: null })
    expect(attributeSale([{ supplierId: 7, balance: -1 }]).pending).toBe(true)
  })

  it('a manual assignment to any listed holder is honored, even to one without sellable stock or when another is the only one with stock', () => {
    expect(attributeSale([{ supplierId: 7, balance: 5 }, { supplierId: 8, balance: 0 }], 8)).toEqual({ supplierId: 8, basis: 'manual', pending: false, suggestion: null })
    expect(attributeSale([{ supplierId: 7, balance: 0 }], 7)).toMatchObject({ supplierId: 7, basis: 'manual', pending: false })
  })

  it('a manual assignment resolves an ambiguity, and only to a supplier that is a holder', () => {
    const holders = [{ supplierId: 7, balance: 5 }, { supplierId: 8, balance: 9 }]

    expect(attributeSale(holders, 7)).toEqual({ supplierId: 7, basis: 'manual', pending: false, suggestion: null })
    expect(attributeSale(holders, 99)).toMatchObject({ pending: true, basis: 'ambiguous' })
  })
})

import { chooseLoss } from './loss'

describe('chooseLoss', () => {
  it('uses the product own history when it has the volume', () => {
    expect(chooseLoss({ product: { lostUnits: 2, suppliedUnits: 100 }, category: { lostUnits: 10, suppliedUnits: 100 } }, 100)).toEqual({ rate: 0.02, level: 'product', suppliedUnits: 100 })
  })

  it('falls back to the category when the product has too little history', () => {
    expect(chooseLoss({ product: { lostUnits: 1, suppliedUnits: 5 }, category: { lostUnits: 7, suppliedUnits: 100 } }, 100)).toMatchObject({ rate: 0.07, level: 'category' })
  })

  it('walks down to store and network', () => {
    expect(chooseLoss({ store: { lostUnits: 3, suppliedUnits: 100 } }, 100)?.level).toBe('store')
    expect(chooseLoss({ network: { lostUnits: 3, suppliedUnits: 100 } }, 100)?.level).toBe('network')
  })

  it('is null when there is no history anywhere — unknown is not 0%', () => {
    expect(chooseLoss({}, 100)).toBeNull()
    expect(chooseLoss({ product: { lostUnits: 0, suppliedUnits: 0 } }, 100)).toBeNull()
  })

  it('keeps a loss of zero when units were supplied and none lost', () => {
    expect(chooseLoss({ category: { lostUnits: 0, suppliedUnits: 80 } }, 100)).toMatchObject({ rate: 0, level: 'category' })
  })
})

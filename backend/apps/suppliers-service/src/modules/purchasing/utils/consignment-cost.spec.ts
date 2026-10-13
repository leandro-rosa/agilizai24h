import { resolveCost, type CostVigencia } from './consignment-cost'

const costs: CostVigencia[] = [
  { sku: 'A', validFrom: '2026-09-01', unitCostCents: 730 },
  { sku: 'A', validFrom: '2026-10-05', unitCostCents: 760 },
  { sku: 'B', validFrom: '2026-09-01', unitCostCents: 595 },
]

describe('resolveCost — the agreed cost in force on the day of the sale', () => {
  it('uses the vigência that was in force on the sale day, not the latest one', () => {
    expect(resolveCost(costs, 'A', new Date('2026-10-04T15:00:00Z'))).toEqual({ unitCostCents: 730, validFrom: '2026-09-01' })
    expect(resolveCost(costs, 'A', new Date('2026-10-06T15:00:00Z'))).toEqual({ unitCostCents: 760, validFrom: '2026-10-05' })
  })

  it('judges the day in Sao Paulo: 02:00Z of Oct 5 is still Oct 4 there', () => {
    expect(resolveCost(costs, 'A', new Date('2026-10-05T02:00:00Z'))?.unitCostCents).toBe(730)
    expect(resolveCost(costs, 'A', new Date('2026-10-05T03:00:00Z'))?.unitCostCents).toBe(760)
  })

  it('returns null — never a guess — before the first vigência or for a SKU without cost', () => {
    expect(resolveCost(costs, 'A', new Date('2026-08-31T15:00:00Z'))).toBeNull()
    expect(resolveCost(costs, 'Z', new Date('2026-10-06T15:00:00Z'))).toBeNull()
  })
})

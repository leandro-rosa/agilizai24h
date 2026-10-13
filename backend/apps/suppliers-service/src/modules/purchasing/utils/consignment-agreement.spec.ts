import { currentCosts, validateCost, validatePeriodDays } from './consignment-agreement'

describe('validatePeriodDays — weekly, every 10, every 15 or a custom number of days', () => {
  it('accepts 7, 10, 15 and any whole number of days from 1 to 366', () => {
    for (const days of [7, 10, 15, 1, 21, 366]) expect(validatePeriodDays(days)).toBeNull()
  })

  it('refuses zero, negatives, fractions and more than a year', () => {
    for (const days of [0, -7, 7.5, 367]) expect(validatePeriodDays(days)).not.toBeNull()
  })
})

describe('validateCost', () => {
  it('accepts a SKU, a real start day and a whole number of cents', () => {
    expect(validateCost({ sku: '110022', valid_from: '2026-09-01', unit_cost_cents: 730 })).toEqual([])
  })

  it('reports every problem at once', () => {
    expect(validateCost({ sku: ' ', valid_from: '2026-02-30', unit_cost_cents: -5 }).length).toBe(3)
  })
})

describe('currentCosts — the cost in force on a day, per SKU', () => {
  const costs = [
    { sku: 'A', valid_from: '2026-09-01', unit_cost_cents: 730 },
    { sku: 'A', valid_from: '2026-10-05', unit_cost_cents: 760 },
    { sku: 'B', valid_from: '2026-11-01', unit_cost_cents: 100 },
  ]

  it('takes the latest vigência that has already started, and omits a SKU that has none yet', () => {
    expect(currentCosts(costs, '2026-10-04')).toEqual([{ sku: 'A', valid_from: '2026-09-01', unit_cost_cents: 730 }])
    expect(currentCosts(costs, '2026-10-05')).toEqual([{ sku: 'A', valid_from: '2026-10-05', unit_cost_cents: 760 }])
  })
})

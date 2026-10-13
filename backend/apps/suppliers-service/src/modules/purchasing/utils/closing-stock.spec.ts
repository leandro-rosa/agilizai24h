import { daysOf, viewStock } from './closing-stock'

describe('closing-stock', () => {
  it('counts both ends of the period', () => {
    expect(daysOf('2026-09-30', '2026-10-12')).toBe(13)
    expect(daysOf('2026-10-01', '2026-10-01')).toBe(1)
  })

  const balances = [{ sku: 'A', in_stores: 69, stores: 21, last_visit: '2026-10-12', oldest_store_visit: '2026-08-18' }]

  it('coverage = stock in the stores / average sold per day', () => {
    const [line] = viewStock({ from: '2026-10-01', to: '2026-10-10', skus: ['A'], balances, sold: new Map([['A', 30]]) })

    expect(line).toMatchObject({ sku: 'A', in_stores: 69, sold_units: 30, per_day: 3, coverage_days: 23 })
  })

  it('nothing sold: no pace and no coverage (never infinite or zero); stock never seen: unknown, not zero', () => {
    const lines = viewStock({ from: '2026-10-01', to: '2026-10-10', skus: ['A', 'Z'], balances, sold: new Map() })

    expect(lines[0]).toMatchObject({ in_stores: 69, per_day: null, coverage_days: null })
    expect(lines[1]).toMatchObject({ sku: 'Z', in_stores: null, last_visit: null, coverage_days: null })
  })
})

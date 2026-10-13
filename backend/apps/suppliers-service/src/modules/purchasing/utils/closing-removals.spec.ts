import { monthsTouched, viewRemovals } from './closing-removals'

const costs = [{ sku: '100083', valid_from: '2026-09-22', unit_cost_cents: 595 }, { sku: '110022', valid_from: '2026-09-22', unit_cost_cents: 730 }]
const rows = [
  { period: '2026-09', sku: '100083', reason: 'expired', quantity: 109 },
  { period: '2026-09', sku: '100083', reason: 'other_reason', quantity: 2 },
  { period: '2026-10', sku: '100083', reason: 'expired', quantity: 10 },
  { period: '2026-10', sku: '110022', reason: 'expired', quantity: 3 },
  { period: '2026-10', sku: '110022', reason: 'return', quantity: 0 },
  { period: '2026-10', sku: '110022', reason: 'transfer', quantity: 7 },
  { period: '2026-08', sku: '100083', reason: 'expired', quantity: 8 },
]
const base = { from: '2026-09-30', to: '2026-10-12', costs, rows, monthsWithData: ['2026-09', '2026-10'] }

describe('monthsTouched', () => {
  it('lists every month the period touches, across a year end', () => {
    expect(monthsTouched('2026-09-30', '2026-10-12')).toEqual(['2026-09', '2026-10'])
    expect(monthsTouched('2026-12-20', '2027-01-03')).toEqual(['2026-12', '2027-01'])
    expect(monthsTouched('2026-10-01', '2026-10-31')).toEqual(['2026-10'])
  })
})

describe('viewRemovals', () => {
  it('shows expired, other reason and returned per month, valued at the agreed cost; other months and reasons stay out', () => {
    const view = viewRemovals(base)

    expect(view.lines).toEqual([
      { sku: '100083', month: '2026-09', expired: { units: 109, cents: 64855 }, other_reason: { units: 2, cents: 1190 }, returned: { units: 0, cents: 0 } },
      { sku: '100083', month: '2026-10', expired: { units: 10, cents: 5950 }, other_reason: { units: 0, cents: 0 }, returned: { units: 0, cents: 0 } },
      { sku: '110022', month: '2026-10', expired: { units: 3, cents: 2190 }, other_reason: { units: 0, cents: 0 }, returned: { units: 0, cents: 0 } },
    ])
    expect(view.totals.expired).toEqual({ units: 122, cents: 72995 })
    expect(view.totals.other_reason).toEqual({ units: 2, cents: 1190 })
    expect(view.basis).toBe('month')
  })

  it('a SKU with no cost keeps its units but has no value (never a made-up zero)', () => {
    const view = viewRemovals({ ...base, costs: [costs[1]] })

    expect(view.lines[0].expired).toEqual({ units: 109, cents: null })
    expect(view.totals.expired.cents).toBeNull()
  })

  it('says which months of the period were never ingested', () => {
    expect(viewRemovals({ ...base, monthsWithData: ['2026-09'] }).months_without_data).toEqual(['2026-10'])
  })
})

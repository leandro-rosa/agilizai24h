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

  describe('only what came after the last closing', () => {
    // October as it was when the last closing was confirmed (to 12/10): 10 expired cones, 3 expired pão de mel.
    const previous = [{ rows: [{ period: '2026-10', sku: '100083', reason: 'expired', quantity: 10 }, { period: '2026-10', sku: '110022', reason: 'expired', quantity: 3 }], months: ['2026-10'], data_until: { '2026-10': '2026-10-12' } }]
    const later = { from: '2026-10-13', to: '2026-10-31', costs, monthsWithData: ['2026-10'], previous }

    it('subtracts what the month already had at the last closing: a later total of 14 cones leaves 4 new ones', () => {
      const view = viewRemovals({ ...later, rows: [{ period: '2026-10', sku: '100083', reason: 'expired', quantity: 14 }, { period: '2026-10', sku: '110022', reason: 'expired', quantity: 3 }], dataUntil: { '2026-10': '2026-10-31' } })

      expect(view.lines.find(l => l.sku === '100083')?.expired).toEqual({ units: 4, cents: 2380 })
      expect(view.lines.find(l => l.sku === '110022')?.expired.units).toBe(0)
      expect(view.scope).toEqual([{ month: '2026-10', mode: 'since_last_closing', data_until: '2026-10-31', dated_ok: true, counted_since: '2026-10-12' }])
    })

    it('a month no closing counted yet is shown whole and says so', () => {
      const view = viewRemovals({ ...base, previous: [] })

      expect(view.scope.map(s => s.mode)).toEqual(['whole_month', 'whole_month'])
    })

    it('data that goes past the last day of the period cannot be dated: dated_ok is false', () => {
      const view = viewRemovals({ ...later, to: '2026-10-20', rows: [{ period: '2026-10', sku: '100083', reason: 'expired', quantity: 14 }], dataUntil: { '2026-10': '2026-10-31' } })

      expect(view.scope[0].dated_ok).toBe(false)
    })

    it('a total smaller than the one already counted never goes negative', () => {
      const view = viewRemovals({ ...later, rows: [{ period: '2026-10', sku: '100083', reason: 'expired', quantity: 8 }], dataUntil: { '2026-10': '2026-10-31' } })

      expect(view.lines.find(l => l.sku === '100083')?.expired.units).toBe(0)
    })
  })
})

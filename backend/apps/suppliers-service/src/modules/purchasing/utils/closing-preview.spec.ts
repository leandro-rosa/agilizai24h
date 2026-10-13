import { previewClosing } from './closing-preview'

const costs = [
  { sku: 'A', valid_from: '2026-09-22', unit_cost_cents: 730 },
  { sku: 'B', valid_from: '2026-09-22', unit_cost_cents: 595 },
  { sku: 'C', valid_from: '2026-09-22', unit_cost_cents: 996 },
]
const base = { from: '2026-09-30', to: '2026-10-12', costs, sales: { rows: [{ sku: 'A', quantity: 50 }, { sku: 'B', quantity: 30 }], months_without_dated_receipts: [] as string[], stores_missing: 0 } }

describe('previewClosing', () => {
  it('owed = units sold × agreed cost; SKUs that did not sell stay out of the lines but are counted', () => {
    const result = previewClosing(base)

    expect(result.status).toBe('ready')
    expect(result.lines).toEqual([
      { sku: 'A', sold_units: 50, unit_cost_cents: 730, total_cents: 36500 },
      { sku: 'B', sold_units: 30, unit_cost_cents: 595, total_cents: 17850 },
    ])
    expect(result.total_units).toBe(80)
    expect(result.total_cents).toBe(54350)
    expect(result.configured_skus).toBe(3)
    expect(result.skus_without_sales).toBe(1)
  })

  it('no sales is its own status: zero units, zero cents, never "ready"', () => {
    const result = previewClosing({ ...base, sales: { ...base.sales, rows: [] } })

    expect(result.status).toBe('no_sales')
    expect(result.total_cents).toBe(0)
  })

  it('a cost that starts or changes inside the period makes it incomplete, naming the SKU', () => {
    const result = previewClosing({ ...base, costs: [...costs, { sku: 'A', valid_from: '2026-10-05', unit_cost_cents: 800 }] })

    expect(result.status).toBe('incomplete')
    expect(result.issues).toEqual([expect.objectContaining({ code: 'cost_changes_in_period', sku: 'A', acceptable: false })])
  })

  it('a SKU whose first cost starts after the first day cannot be priced for the whole period', () => {
    const result = previewClosing({ ...base, costs: [{ sku: 'A', valid_from: '2026-10-05', unit_cost_cents: 800 }], sales: { ...base.sales, rows: [{ sku: 'A', quantity: 3 }] } })

    expect(result.status).toBe('incomplete')
    expect(result.issues[0]).toMatchObject({ code: 'cost_changes_in_period', sku: 'A' })
  })

  it('receipts without a date make the sold units unknown (blocking); a store without import can be accepted', () => {
    const unknown = previewClosing({ ...base, sales: { ...base.sales, months_without_dated_receipts: ['2026-10'] } })
    expect(unknown.status).toBe('incomplete')
    expect(unknown.issues[0]).toMatchObject({ code: 'sales_dates_missing', acceptable: false })

    const stores = previewClosing({ ...base, sales: { ...base.sales, stores_missing: 2 } })
    expect(stores.status).toBe('incomplete')
    expect(stores.issues[0]).toMatchObject({ code: 'stores_missing', acceptable: true })
  })

  it('sales of a SKU with no agreement cost are ignored: the supplier does not own it', () => {
    const result = previewClosing({ ...base, sales: { ...base.sales, rows: [...base.sales.rows, { sku: 'ZZZ', quantity: 9 }] } })

    expect(result.total_units).toBe(80)
  })
})

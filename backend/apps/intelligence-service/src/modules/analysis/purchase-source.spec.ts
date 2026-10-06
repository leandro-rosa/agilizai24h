import { HttpPurchaseSource, NullPurchaseSource } from './purchase-source'

const summary = (over: Record<string, unknown> = {}) => ({
  month: '2026-10',
  base_from: '2026-10',
  orders: 2,
  invoices: 1,
  rows: [
    { sku: 'A', units_paid: 100, units_on_sale: 50, bonus_units: 0, cents_paid: 80000, cents_on_sale: 25000 },
    { sku: 'B', units_paid: 0, units_on_sale: 0, bonus_units: 12, cents_paid: 0, cents_on_sale: 0 },
    { sku: 'Z', units_paid: 5, units_on_sale: 0, bonus_units: 0, cents_paid: 1, cents_on_sale: 0 },
  ],
  ...over,
})

describe('HttpPurchaseSource', () => {
  const make = (value: unknown) => {
    const client = { purchaseSummary: jest.fn(async () => value) }

    return { source: new HttpPurchaseSource(client as never), client }
  }

  it('reports the bought units and cost (paid + on sale) and the bonus units, only for the SKUs asked', async () => {
    const { source } = make(summary())
    const month = await source.month(['A', 'B', 'NONE'], '2026-10')

    expect(month?.get('A')).toEqual({ units: 150, cents: 105000, bonusUnits: 0 })
    expect(month?.get('B')).toEqual({ units: 0, cents: 0, bonusUnits: 12 })
    expect(month?.has('Z')).toBe(false)
    // After the base, a SKU with no purchase is a real zero: absent from the map, not "no history".
    expect(month?.has('NONE')).toBe(false)
  })

  it('is "no purchase history" (null) before the first recorded purchase, never zero', async () => {
    const { source } = make(summary({ base_from: '2026-10' }))

    expect(await source.month(['A'], '2026-09')).toBeNull()
    expect(await make(summary({ base_from: null, rows: [] })).source.month(['A'], '2026-10')).toBeNull()
  })

  it('reads the base month and caches a month for a minute', async () => {
    const { source, client } = make(summary())
    await source.month(['A'], '2026-10')
    await source.month(['B'], '2026-10')

    expect(client.purchaseSummary).toHaveBeenCalledTimes(1)
    expect(await source.baseFrom()).toBe('2026-10')
  })

  it('does not hide a failing purchases service as "no history"', async () => {
    const source = new HttpPurchaseSource({ purchaseSummary: jest.fn(async () => Promise.reject(new Error('down'))) } as never)

    await expect(source.month(['A'], '2026-10')).rejects.toThrow('down')
  })
})

describe('NullPurchaseSource', () => {
  it('says there is no history', async () => {
    expect(await new NullPurchaseSource().month()).toBeNull()
    expect(await new NullPurchaseSource().baseFrom()).toBeNull()
  })
})

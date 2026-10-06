import { BadRequestException, NotFoundException } from '@nestjs/common'
import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import { AnalysisService } from './analysis.service'
import { NullPurchaseSource } from './purchase-source'

const month = (restocks: Record<string, number>, removals: Record<string, number> = {}) => ({
  store_id: 0,
  period: '',
  restocks: Object.entries(restocks).map(([sku, quantity_restocked]) => ({ sku, quantity_restocked })),
  removals: Object.entries(removals).map(([sku, quantity_removed]) => ({ sku, reason: 'expired', counts_as_loss: true, quantity_removed })),
  adjustments: [],
})

const VISITS = [
  { id: 1, period: '2026-10', kind: 'x', started_at: null, ended_at: '2026-10-05T10:00:00.000Z', previous_ended_at: null, source_reference: 'a', lines: [{ sku: 'A', restocked: 10, removed_total: -1 }] },
  {
    id: 2,
    period: '2026-10',
    kind: 'x',
    started_at: null,
    ended_at: '2026-10-20T10:00:00.000Z',
    previous_ended_at: null,
    source_reference: 'b',
    lines: [
      { sku: 'A', restocked: 20, removed_total: -1 },
      { sku: 'B', restocked: 10, removed_total: 0 },
    ],
  },
]
const RECEIPTS = [
  { sku: 'A', quantity: 10, amount_paid_cents: 10000, result: 'OK', occurred_at: '2026-10-03T12:00:00.000Z' },
  { sku: 'A', quantity: 14, amount_paid_cents: 14000, result: 'OK', occurred_at: '2026-10-25T12:00:00.000Z' },
  { sku: 'A', quantity: 3, amount_paid_cents: 3000, result: 'REFUSED', occurred_at: '2026-10-04T12:00:00.000Z' },
]

function build(options: { supply?: Record<string, unknown>; sales?: Record<string, unknown>; receipts?: unknown[] | null } = {}) {
  const supply = {
    visits: jest.fn(async (_store: number, from: string) => (from === '2026-10' ? VISITS : [])),
    period: jest.fn(async (store: number, period: string) => {
      const key = `${store}:${period}`
      if (options.supply && key in options.supply) return options.supply[key] ?? null
      return period === '2026-10' ? month({ A: 30, B: 10 }, { A: 2 }) : null
    }),
  }
  const sales = {
    transactions: jest.fn(async (_store: number, period: string) => (period === '2026-10' ? (options.receipts === undefined ? RECEIPTS : options.receipts) : null)),
    period: jest.fn(async (store: number, period: string) => {
      const key = `${store}:${period}`
      if (options.sales && key in options.sales) return options.sales[key] ?? null
      return period === '2026-10' ? [{ sku: 'A', quantity_sold: 24, revenue_cents: 24000 }] : null
    }),
  }
  const products = {
    products: jest.fn(async () => [
      { id: 1, sku: 'A', name: 'Marmita A', supplier_id: 5 },
      { id: 2, sku: 'B', name: 'Marmita B', supplier_id: 5 },
      { id: 3, sku: 'C', name: 'Sem fornecedor', supplier_id: null },
      { id: 4, sku: 'Z', name: 'Produto [teste]', supplier_id: 5 },
    ]),
    costsAsOf: jest.fn(async (skus: string[], asOf: string) => ({
      as_of: asOf,
      resolved: skus.filter(s => s === 'A').map(sku => ({ sku, product_id: 1, cost_cents: 600, effective_from: '2026-01-01' })),
      unresolved: skus.filter(s => s !== 'A').map(sku => ({ sku, reason: 'no_cost_for_date' })),
      complete: false,
    })),
  }
  const stores = { stores: jest.fn(async () => [{ id: 1, name: 'Ascenty ADM' }, { id: 2, name: 'Loja Sintética' }]) }
  const parameters = { current: jest.fn(async () => ({ id: 3, values: DEFAULT_PARAMETERS })) }
  const service = new AnalysisService(supply as never, sales as never, products as never, stores as never, parameters as never, new NullPurchaseSource())

  return { service, supply, sales, products }
}

const m = (to: string, from = to) => ({ from, to })

describe('AnalysisService', () => {
  it('attributes products to a supplier only by the declared link and leaves out synthetic products', async () => {
    const { service } = build()
    const result = await service.supplier(5, m('2026-10'), 'prev_month')

    expect(result.products.map(p => p.sku).sort()).toEqual(['A', 'B'])
    expect(result.products.find(p => p.sku === 'C')).toBeUndefined()
    expect(result.totals.current.restocked).toEqual({ available: true, value: 40 })
    expect(result.totals.current.lost).toEqual({ available: true, value: 2 })
  })

  it('flags products below the attention margin and gives the profit, price, markup and cost coverage', async () => {
    const { service } = build()
    const result = await service.supplier(5, m('2026-10'), 'prev_month')
    const a = result.products.find(p => p.sku === 'A')!.movement

    // A: 24 sold for 24000 cents at a unit cost of 600 → price 1000, profit 24000 − 14400, markup 1000/600.
    expect(a.avgPriceCents).toEqual({ available: true, value: 1000 })
    expect(a.grossProfitCents).toEqual({ available: true, value: 9600 })
    expect(a.markup.available && a.markup.value).toBeCloseTo(24000 / 14400)
    expect(a.costCoverage).toEqual({ available: true, value: 1 })
    expect(result.attention).toMatchObject({ threshold: 0.2, count: 0, rated: 1 })
  })

  it('never reads synthetic stores', async () => {
    const { service, supply } = build()
    await service.supplier(5, m('2026-10'), 'prev_month')

    expect(supply.period.mock.calls.some(([store]) => store === 2)).toBe(false)
  })

  it('returns purchases as unavailable with the reason, and no purchase insight', async () => {
    const { service } = build()
    const result = await service.supplier(5, m('2026-10'), 'prev_month')

    expect(result.totals.current.purchasedUnits).toEqual({ available: false, reason: 'no_purchase_history' })
    expect(result.evolution.every(point => !point.purchasedUnits.available)).toBe(true)
    expect(result.insights.map(i => i.kind)).not.toContain('purchases_change')
  })

  it('treats a month never ingested as unavailable, not as zero, in the six-month evolution', async () => {
    const { service } = build()
    const result = await service.supplier(5, m('2026-10'), 'prev_month')

    expect(result.evolution).toHaveLength(6)
    expect(result.evolution.map(p => p.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(result.evolution[0].sold).toEqual({ available: false, reason: 'never_ingested' })
    expect(result.evolution[5].sold).toEqual({ available: true, value: 24 })
    expect(result.totals.comparison.sold.change).toEqual({ available: false, reason: 'never_ingested' })
  })

  it('flags months with incomplete data in the quality block', async () => {
    const { service } = build({ sales: { '1:2026-10': null } })
    const result = await service.supplier(5, m('2026-10'), 'prev_month')

    expect(result.meta.dataQuality.monthsWithGaps.find(m => m.month === '2026-10')).toMatchObject({ storesMissingSales: 1 })
    expect(result.totals.current.sold).toEqual({ available: false, reason: 'never_ingested' })
    expect(result.meta.parameterVersion).toBe(3)
  })

  it('values the loss at cost and reports an uncosted SKU honestly', async () => {
    const { service } = build()
    const product = await service.product('A', m('2026-10'), 'prev_month')
    const b = await service.product('B', m('2026-10'), 'prev_month')

    expect(product.totals.current.lossCents).toEqual({ available: true, value: 1200 })
    expect(product.stores).toHaveLength(1)
    expect(product.stores[0]).toMatchObject({ storeId: 1, restocked: 30, sold: 24, lost: 2, situation: 'good' })
    expect(b.totals.current.lossCents).toEqual({ available: true, value: 0 })
  })

  it('answers the cross view only for the declared supplier of the product', async () => {
    const { service } = build()
    const linked = await service.cross(5, 'A', m('2026-10'), 'prev_month')
    const other = await service.cross(9, 'A', m('2026-10'), 'prev_month')
    const none = await service.cross(5, 'C', m('2026-10'), 'prev_month')

    expect(linked.linked).toBe(true)
    expect(linked.totals).not.toBeNull()
    expect(other.linked).toBe(false)
    expect(other.totals).toBeNull()
    expect(none.linked).toBe(false)
    expect(none.product.declaredSupplierId).toBeNull()
    expect(linked.suppliersUnavailableReason).toBe('no_purchase_history')
  })

  describe('a range of months', () => {
    it('sums the range, names the period it is compared with, and reads the period before it', async () => {
      const { service } = build()
      const result = await service.supplier(5, m('2026-10', '2026-09'), 'prev_month')

      expect(result.meta).toMatchObject({ from: '2026-09', period: '2026-10', months: 2, previous: { from: '2026-07', to: '2026-08' } })
      // Only October has data in the fixture: September counts as missing, so the total is partial, not zero.
      expect(result.totals.current.restocked).toEqual({ available: true, value: 40, partial: true })
      expect(result.totals.comparison.restocked.change).toEqual({ available: false, reason: 'never_ingested' })
      expect(result.evolution.map(p => p.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    })

    it('shows every month of a long range in the evolution', async () => {
      const { service } = build()
      const result = await service.supplier(5, m('2026-10', '2026-01'), 'prev_month')

      expect(result.meta.months).toBe(10)
      expect(result.evolution).toHaveLength(10)
    })

    it('refuses a reversed range, one over a year, and a 3-month average over a range', async () => {
      const { service } = build()

      await expect(service.supplier(5, m('2026-05', '2026-08'), 'prev_month')).rejects.toBeInstanceOf(BadRequestException)
      await expect(service.supplier(5, m('2026-10', '2025-09'), 'prev_month')).rejects.toBeInstanceOf(BadRequestException)
      await expect(service.supplier(5, m('2026-10', '2026-09'), 'avg_3m')).rejects.toBeInstanceOf(BadRequestException)
    })

    it('a single month behaves as before', async () => {
      const { service } = build()
      const result = await service.supplier(5, m('2026-10'), 'prev_month')

      expect(result.meta).toMatchObject({ from: '2026-10', months: 1, previous: null })
    })
  })

  describe('a range of days', () => {
    const days = (from: string, to: string) => ({ from, to })

    it('reads restocks from the visits, sales from the dated receipts, and allocates the loss as an estimate', async () => {
      const { service } = build()
      const result = await service.product('A', days('2026-10-01', '2026-10-10'), 'prev_month')

      expect(result.meta).toMatchObject({ granularity: 'day', fromDate: '2026-10-01', toDate: '2026-10-10', days: 10, comparisonLabel: 'período anterior' })
      expect(result.meta.previous).toEqual({ from: '2026-09-21', to: '2026-09-30' })
      expect(result.totals.current.restocked).toEqual({ available: true, value: 10 })
      // Only the receipt of the 3rd counts: the refused one and the one on the 25th do not.
      expect(result.totals.current.sold).toEqual({ available: true, value: 10 })
      expect(result.totals.current.revenueCents).toEqual({ available: true, value: 10000 })
      // The month lost 2 units; this window holds half of the units the visits removed.
      expect(result.totals.current.lost).toEqual({ available: true, value: 1, estimated: true })
      expect(result.meta.daily).toEqual({ salesDetailMissingMonths: [], lossEstimated: true })
    })

    it('a day range that is whole months is the monthly record, exact and not estimated', async () => {
      const { service } = build()
      const result = await service.product('A', days('2026-10-01', '2026-10-31'), 'prev_month')

      expect(result.meta).toMatchObject({ granularity: 'month', months: 1 })
      expect(result.totals.current.lost).toEqual({ available: true, value: 2 })
      expect(result.meta.daily).toBeNull()
    })

    it('says the day sales are unknown — not zero — when the receipts carry no date', async () => {
      const { service } = build({ receipts: [{ sku: 'A', quantity: 10, amount_paid_cents: 10000, result: 'OK', occurred_at: null }] })
      const result = await service.product('A', days('2026-10-01', '2026-10-10'), 'prev_month')

      expect(result.totals.current.sold).toEqual({ available: false, reason: 'never_ingested' })
      expect(result.totals.current.restocked).toEqual({ available: true, value: 10 })
      expect(result.meta.daily?.salesDetailMissingMonths).toEqual(['2026-10'])
    })

    it('sums the whole months inside the range with the edge days of the others', async () => {
      const { service } = build()
      const result = await service.product('A', days('2026-09-15', '2026-10-10'), 'prev_month')

      // September (15–30) has no supply or receipts ingested; October's days 1–10 add 10 restocked.
      expect(result.totals.current.restocked).toEqual({ available: true, value: 10, partial: true })
    })

    it('refuses impossible dates, ranges over a year, and a 3-month average over days', async () => {
      const { service } = build()

      await expect(service.product('A', days('2026-02-30', '2026-03-05'), 'prev_month')).rejects.toBeInstanceOf(BadRequestException)
      await expect(service.product('A', days('2026-03-05', '2026-03-01'), 'prev_month')).rejects.toBeInstanceOf(BadRequestException)
      await expect(service.product('A', days('2025-09-01', '2026-10-10'), 'prev_month')).rejects.toBeInstanceOf(BadRequestException)
      await expect(service.product('A', days('2026-10-01', '2026-10-10'), 'avg_3m')).rejects.toBeInstanceOf(BadRequestException)
      await expect(service.product('A', { from: '2026-10', to: '2026-10-10' }, 'prev_month')).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  it('rejects a bad period or comparison and an unknown product', async () => {
    const { service } = build()

    await expect(service.supplier(5, m('2026-13'), 'prev_month')).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.supplier(5, m('2026-10'), 'weird' as never)).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.product('NOPE', m('2026-10'), 'prev_month')).rejects.toBeInstanceOf(NotFoundException)
  })
})

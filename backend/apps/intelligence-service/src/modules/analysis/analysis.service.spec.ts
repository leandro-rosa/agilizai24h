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

function build(options: { supply?: Record<string, unknown>; sales?: Record<string, unknown> } = {}) {
  const supply = {
    period: jest.fn(async (store: number, period: string) => {
      const key = `${store}:${period}`
      if (options.supply && key in options.supply) return options.supply[key] ?? null
      return period === '2026-10' ? month({ A: 30, B: 10 }, { A: 2 }) : null
    }),
  }
  const sales = {
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

describe('AnalysisService', () => {
  it('attributes products to a supplier only by the declared link and leaves out synthetic products', async () => {
    const { service } = build()
    const result = await service.supplier(5, '2026-10', 'prev_month')

    expect(result.products.map(p => p.sku).sort()).toEqual(['A', 'B'])
    expect(result.products.find(p => p.sku === 'C')).toBeUndefined()
    expect(result.totals.current.restocked).toEqual({ available: true, value: 40 })
    expect(result.totals.current.lost).toEqual({ available: true, value: 2 })
  })

  it('flags products below the attention margin and gives the profit, price, markup and cost coverage', async () => {
    const { service } = build()
    const result = await service.supplier(5, '2026-10', 'prev_month')
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
    await service.supplier(5, '2026-10', 'prev_month')

    expect(supply.period.mock.calls.some(([store]) => store === 2)).toBe(false)
  })

  it('returns purchases as unavailable with the reason, and no purchase insight', async () => {
    const { service } = build()
    const result = await service.supplier(5, '2026-10', 'prev_month')

    expect(result.totals.current.purchasedUnits).toEqual({ available: false, reason: 'no_purchase_history' })
    expect(result.evolution.every(point => !point.purchasedUnits.available)).toBe(true)
    expect(result.insights.map(i => i.kind)).not.toContain('purchases_change')
  })

  it('treats a month never ingested as unavailable, not as zero, in the six-month evolution', async () => {
    const { service } = build()
    const result = await service.supplier(5, '2026-10', 'prev_month')

    expect(result.evolution).toHaveLength(6)
    expect(result.evolution.map(p => p.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(result.evolution[0].sold).toEqual({ available: false, reason: 'never_ingested' })
    expect(result.evolution[5].sold).toEqual({ available: true, value: 24 })
    expect(result.totals.comparison.sold.change).toEqual({ available: false, reason: 'never_ingested' })
  })

  it('flags months with incomplete data in the quality block', async () => {
    const { service } = build({ sales: { '1:2026-10': null } })
    const result = await service.supplier(5, '2026-10', 'prev_month')

    expect(result.meta.dataQuality.monthsWithGaps.find(m => m.month === '2026-10')).toMatchObject({ storesMissingSales: 1 })
    expect(result.totals.current.sold).toEqual({ available: false, reason: 'never_ingested' })
    expect(result.meta.parameterVersion).toBe(3)
  })

  it('values the loss at cost and reports an uncosted SKU honestly', async () => {
    const { service } = build()
    const product = await service.product('A', '2026-10', 'prev_month')
    const b = await service.product('B', '2026-10', 'prev_month')

    expect(product.totals.current.lossCents).toEqual({ available: true, value: 1200 })
    expect(product.stores).toHaveLength(1)
    expect(product.stores[0]).toMatchObject({ storeId: 1, restocked: 30, sold: 24, lost: 2, situation: 'good' })
    expect(b.totals.current.lossCents).toEqual({ available: true, value: 0 })
  })

  it('answers the cross view only for the declared supplier of the product', async () => {
    const { service } = build()
    const linked = await service.cross(5, 'A', '2026-10', 'prev_month')
    const other = await service.cross(9, 'A', '2026-10', 'prev_month')
    const none = await service.cross(5, 'C', '2026-10', 'prev_month')

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
      const result = await service.supplier(5, '2026-10', 'prev_month', undefined, undefined, '2026-09')

      expect(result.meta).toMatchObject({ from: '2026-09', period: '2026-10', months: 2, previous: { from: '2026-07', to: '2026-08' } })
      // Only October has data in the fixture: September counts as missing, so the total is partial, not zero.
      expect(result.totals.current.restocked).toEqual({ available: true, value: 40, partial: true })
      expect(result.totals.comparison.restocked.change).toEqual({ available: false, reason: 'never_ingested' })
      expect(result.evolution.map(p => p.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    })

    it('shows every month of a long range in the evolution', async () => {
      const { service } = build()
      const result = await service.supplier(5, '2026-10', 'prev_month', undefined, undefined, '2026-01')

      expect(result.meta.months).toBe(10)
      expect(result.evolution).toHaveLength(10)
    })

    it('refuses a reversed range, one over a year, and a 3-month average over a range', async () => {
      const { service } = build()

      await expect(service.supplier(5, '2026-05', 'prev_month', undefined, undefined, '2026-08')).rejects.toBeInstanceOf(BadRequestException)
      await expect(service.supplier(5, '2026-10', 'prev_month', undefined, undefined, '2025-09')).rejects.toBeInstanceOf(BadRequestException)
      await expect(service.supplier(5, '2026-10', 'avg_3m', undefined, undefined, '2026-09')).rejects.toBeInstanceOf(BadRequestException)
    })

    it('a single month behaves as before', async () => {
      const { service } = build()
      const result = await service.supplier(5, '2026-10', 'prev_month')

      expect(result.meta).toMatchObject({ from: '2026-10', months: 1, previous: null })
    })
  })

  it('rejects a bad period or comparison and an unknown product', async () => {
    const { service } = build()

    await expect(service.supplier(5, '2026-13', 'prev_month')).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.supplier(5, '2026-10', 'weird' as never)).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.product('NOPE', '2026-10', 'prev_month')).rejects.toBeInstanceOf(NotFoundException)
  })
})

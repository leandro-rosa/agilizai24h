import { ConflictException, NotFoundException } from '@nestjs/common'
import { computePrice, type PriceInput, type PriceResult } from './price'
import { DEFAULT_PRICING_PARAMETERS, mergePricingParameters } from './pricing.parameters'
import { PricingProductService } from './pricing-product.service'
import { InvalidPriceError } from './simulate'

const params = mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { taxRateBps: 707 })
const input = (overrides: Partial<PriceInput> = {}): PriceInput => ({
  sku: 'COCA',
  category: 'beverage',
  costCents: 309,
  costAgeDays: 10,
  costFromPurchase: true,
  costFlaggedUnreliable: false,
  previousCostCents: 280,
  currentPriceCents: 590,
  monthlyUnits: 100,
  volumeDroppedAfterPriceChange: false,
  loss: { rate: 0.02, level: 'product' },
  payment: { rate: 0.02, fixedPerUnitCents: 0, components: [], voucherShare: 0.2, voucherBasis: 'sales_weighted', unresolvedShare: 0, complete: true, notes: [] },
  operatingShare: 0.04,
  params,
  ...overrides,
})

function build(options: { report?: PriceResult[] | null; costs?: Record<string, number | null>; prices?: Record<string, number | null> } = {}) {
  const products = {
    products: async () => [{ id: 1, sku: 'COCA', name: 'Coca' }],
    costsAsOf: async (_skus: string[], asOf: string) => {
      const value = (options.costs ?? {})[asOf.slice(0, 7)]
      return { resolved: value == null ? [] : [{ sku: 'COCA', product_id: 1, cost_cents: value, effective_from: asOf }], unresolved: [], complete: value != null, as_of: asOf }
    },
    pricesAsOf: async (_skus: string[], asOf: string) => {
      const value = (options.prices ?? {})[asOf.slice(0, 7)]
      return { resolved: value == null ? [] : [{ sku: 'COCA', product_id: 1, price_cents: value, effective_from: asOf }], unresolved: [], complete: value != null }
    },
  }
  const stores = { stores: async () => [{ id: 1, name: 'Loja Alfa' }, { id: 2, name: 'Loja Beta' }, { id: 3, name: 'Loja Gama' }] }
  const supply = {
    period: async (storeId: number) => (storeId === 3 ? null : { store_id: storeId, period: 'x', restocks: [{ sku: 'COCA', quantity_restocked: 100 }], removals: [{ sku: 'COCA', reason: 'expired', counts_as_loss: true, quantity_removed: storeId === 1 ? 2 : 10 }], adjustments: [] }),
  }
  const sales = { period: async (storeId: number) => (storeId === 3 ? null : [{ sku: 'COCA', quantity_sold: 90, revenue_cents: 53_100 }]) }
  const runs = {
    scope: (period?: string) => ({ period: period ?? '2026-09', storeId: null }),
    latest: async () =>
      options.report === null
        ? { state: 'none', run: null, report: null, scope: { period: '2026-09', storeId: null } }
        : { state: 'ready', run: { id: 'run-1' }, report: { summary: { targetMargin: 0.35 }, products: options.report ?? [computePrice(input())] }, scope: { period: '2026-09', storeId: null } },
  }

  return new PricingProductService(supply as never, sales as never, products as never, stores as never, runs as never)
}

describe('PricingProductService.history', () => {
  it('returns a row per month and leaves a month without a cost empty, not zero', async () => {
    const service = build({ costs: { '2026-07': 280, '2026-09': 309 }, prices: { '2026-07': 590, '2026-08': 590, '2026-09': 590 } })
    const result = await service.history('COCA', { period: '2026-09', months: 3 })

    expect(result.marginKind).toBe('product_margin')
    expect(result.rows.map(row => row.month)).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(result.rows[1]).toMatchObject({ costCents: null, margin: null, markup: null })
    expect(result.rows[2]).toMatchObject({ costCents: 309, priceCents: 590 })
  })

  it('refuses an unknown product', async () => {
    await expect(build().history('NOPE', { period: '2026-09' })).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('PricingProductService.simulate', () => {
  it('simulates over the stored structure and names the run it used', async () => {
    const result = await build().simulate('COCA', { priceCents: 650, period: '2026-09' })

    expect(result).toMatchObject({ simulable: true, priceCents: 650, reportRunId: 'run-1' })
  })

  it('refuses a price that is not a positive whole number of centavos', async () => {
    await expect(build().simulate('COCA', { priceCents: 6.5 })).rejects.toBeInstanceOf(InvalidPriceError)
  })

  it('asks for a report first when the scope has none', async () => {
    await expect(build({ report: null }).simulate('COCA', { priceCents: 650 })).rejects.toBeInstanceOf(ConflictException)
  })

  it('says a product without a structure cannot be simulated, with no invented figures', async () => {
    const without = computePrice(input({ costCents: null }))
    const result = await build({ report: [without] }).simulate('COCA', { priceCents: 650 })

    expect(result).toMatchObject({ simulable: false })
    expect(result).not.toHaveProperty('margin')
  })

  it('refuses a product that is not in the stored report', async () => {
    await expect(build().simulate('NOPE', { priceCents: 650 })).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('PricingProductService.storesOf', () => {
  it('shows each store its own volume and loss, with the lossier store at the lower margin', async () => {
    const result = await build().storesOf('COCA', { period: '2026-09' })
    const alfa = result.stores.find(store => store.storeName === 'Loja Alfa')!
    const beta = result.stores.find(store => store.storeName === 'Loja Beta')!

    expect(alfa.unitsSold).toBe(90 * 3)
    expect(alfa.lossRate).toBeCloseTo(6 / 300, 8)
    expect(beta.lossRate).toBeCloseTo(30 / 300, 8)
    expect(beta.estimatedMargin as number).toBeLessThan(alfa.estimatedMargin as number)
    expect(result.note).toContain('rede')
  })

  it('lists a store that never recorded the period as missing, not as zero sales', async () => {
    const result = await build().storesOf('COCA', { period: '2026-09' })

    expect(result.missingStores).toEqual([{ storeId: 3, storeName: 'Loja Gama' }])
    expect(result.stores.some(store => store.storeId === 3)).toBe(false)
  })
})

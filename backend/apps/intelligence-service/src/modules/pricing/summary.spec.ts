import { computePrice, type PriceInput } from './price'
import { DEFAULT_PRICING_PARAMETERS, mergePricingParameters } from './pricing.parameters'
import { byCategory, summarise } from './summary'

const params = mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { taxRateBps: 707 })
const input = (sku: string, category: string | null, price: number, overrides: Partial<PriceInput> = {}): PriceInput => ({
  sku,
  category,
  costCents: 300,
  costAgeDays: 5,
  costFromPurchase: true,
  costFlaggedUnreliable: false,
  previousCostCents: 300,
  currentPriceCents: price,
  monthlyUnits: 100,
  volumeDroppedAfterPriceChange: false,
  loss: { rate: 0.02, level: 'product' },
  payment: { rate: 0.02, fixedPerUnitCents: 0, components: [], voucherShare: 0.2, voucherBasis: 'sales_weighted', unresolvedShare: 0, complete: true, notes: [] },
  operatingShare: 0.04,
  params,
  ...overrides,
})

describe('byCategory', () => {
  it('names a category by its Portuguese label and keeps the key', () => {
    const rows = byCategory([computePrice(input('A', 'beverage', 590)), computePrice(input('B', 'frozen', 590)), computePrice(input('C', null, 590))], new Map([['A', 1000], ['B', 500], ['C', 100]]))

    expect(rows.map(row => [row.category, row.categoryKey])).toEqual([
      ['Bebidas', 'beverage'],
      ['Outros', 'frozen'],
      ['Outros', ''],
    ])
  })

  it('weights the margin by revenue and shares the revenue', () => {
    const rows = byCategory([computePrice(input('A', 'beverage', 590)), computePrice(input('B', 'beverage', 700))], new Map([['A', 3000], ['B', 1000]]))
    const a = computePrice(input('A', 'beverage', 590)).currentMargin as number
    const b = computePrice(input('B', 'beverage', 700)).currentMargin as number

    expect(rows[0].averageMargin).toBeCloseTo((a * 3000 + b * 1000) / 4000, 8)
    expect(rows[0].revenueShare).toBe(1)
  })

  it('has no margin for a category with no rated product, never zero', () => {
    const rows = byCategory([computePrice(input('A', 'beverage', 590, { costCents: null }))], new Map([['A', 1000]]))

    expect(rows[0]).toMatchObject({ averageMargin: null, difference: null })
  })
})

describe('summarise', () => {
  it('counts the statuses and sums the estimated impact, labelled', () => {
    const results = [computePrice(input('A', 'beverage', 400)), computePrice(input('B', 'beverage', 900)), computePrice(input('C', 'beverage', 590, { costCents: null }))]
    const summary = summarise(results, 0.35, new Map([['A', 1000], ['B', 1000]]))

    expect(summary).toMatchObject({ analysed: 3, belowTarget: 1, insufficientData: 1, impactLabel: 'Impacto potencial estimado' })
    expect(summary.potentialImpactCentsPerMonth).toBeGreaterThan(0)
    expect(summary.shares.insufficientData).toBeCloseTo(1 / 3, 8)
  })

  it('has no average margin without revenue weights, never zero', () => {
    expect(summarise([computePrice(input('A', 'beverage', 590))], 0.35, new Map()).averageMargin).toBeNull()
  })
})

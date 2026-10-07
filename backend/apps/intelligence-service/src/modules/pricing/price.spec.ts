import { computePrice, shapePrice, type PriceInput } from './price'
import { DEFAULT_PRICING_PARAMETERS, mergePricingParameters } from './pricing.parameters'
import { ANALYSIS_ONLY_STATEMENT, type PaymentCost } from './pricing.types'

const payment = (overrides: Partial<PaymentCost> = {}): PaymentCost => ({ rate: 0.02, components: [], voucherShare: 0.22, voucherBasis: 'sales_weighted', unresolvedShare: 0, complete: true, notes: [], ...overrides })

const PARAMS = mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { taxRateBps: 707 })

// Hand-computed: cost 309, tax 7.07%, payment 2%, operating 4% => variable share 0.1307; loss 2% => cost per sold unit 309 / 0.98 = 315.306
const base = (overrides: Partial<PriceInput> = {}): PriceInput => ({
  sku: 'COCA',
  name: 'Coca-Cola Lata 350ml',
  category: 'Bebidas',
  costCents: 309,
  costAgeDays: 10,
  costFromPurchase: true,
  costFlaggedUnreliable: false,
  previousCostCents: 280,
  currentPriceCents: 590,
  monthlyUnits: 325,
  volumeDroppedAfterPriceChange: false,
  loss: { rate: 0.02, level: 'product' },
  payment: payment(),
  operatingShare: 0.04,
  params: PARAMS,
  ...overrides,
})

describe('computePrice', () => {
  it('solves minimum, target and recommended prices from the cost structure', () => {
    const result = computePrice(base())

    expect(result.currentMargin).toBeCloseTo(0.33488, 4)
    expect(result.minimumPriceCents).toBe(560) // 553.8 rounded up to the 10-cent step
    expect(result.targetPriceCents).toBe(610) // 607.15 rounded up
    expect(result.recommendedPriceCents).toBe(610)
    expect(result.status).toBe('adjust')
    expect(result.reasons.map(reason => reason.code)).toContain('below_target')
    expect(result.reasons.map(reason => reason.code)).toContain('cost_moved')
  })

  it('is not cost x markup nor cost / (1 - margin)', () => {
    const naive = Math.ceil(309 / (1 - 0.35))
    const result = computePrice(base())

    expect(result.targetPriceCents).not.toBe(naive)
  })

  it('estimates the monthly impact with volume held constant and labels it', () => {
    const result = computePrice(base())

    expect(result.impactCentsPerMonth).toBeCloseTo(325 * 17.386, 0)
    expect(result.impactLabel).toBe('Impacto potencial estimado')
    expect(result.recommendedMargin).toBeGreaterThan(result.currentMargin as number)
  })

  it('prices a lossier product higher', () => {
    const low = computePrice(base({ loss: { rate: 0.02, level: 'product' } }))
    const high = computePrice(base({ loss: { rate: 0.12, level: 'product' } }))

    expect(high.targetPriceCents).toBeGreaterThan(low.targetPriceCents as number)
    expect(high.targetPriceCents).toBe(680) // 351.136 / 0.5193 = 676.2
  })

  it('carries the analysis-only statement in the structure', () => {
    expect(computePrice(base()).structure?.statement).toBe(ANALYSIS_ONLY_STATEMENT)
  })

  it('keeps a product on target as healthy at its current price', () => {
    const result = computePrice(base({ currentPriceCents: 700 }))

    expect(result.status).toBe('healthy')
    expect(result.recommendedPriceCents).toBe(700)
    expect(result.impactCentsPerMonth).toBe(0)
  })

  it('flags an opportunity near the target with volume', () => {
    const result = computePrice(base({ currentPriceCents: 620 }))

    expect(result.currentMargin).toBeCloseTo(0.3607, 3)
    expect(result.status).toBe('opportunity')
    expect(result.recommendedPriceCents).toBe(630)
  })

  it('asks for review instead of raising after volume fell following a price change', () => {
    const result = computePrice(base({ volumeDroppedAfterPriceChange: true }))

    expect(result.status).toBe('review')
    expect(result.recommendedPriceCents).toBe(590)
  })

  it('caps a single increase and says so', () => {
    const result = computePrice(base({ currentPriceCents: 400, params: mergePricingParameters(PARAMS, { guards: { maxIncreaseBps: 1000 } }) }))

    expect(result.recommendedPriceCents).toBe(440)
    expect(result.reasons.map(reason => reason.code)).toContain('increase_capped')
  })

  it('compares margin in R$ per month, not only the percentage', () => {
    const a = computePrice(base({ currentPriceCents: 471, monthlyUnits: 1000 }))
    const b = computePrice(base({ costCents: 100, currentPriceCents: 603, monthlyUnits: 10, previousCostCents: null }))

    expect(a.currentMargin).toBeCloseTo(0.2, 2)
    expect(b.currentMargin).toBeCloseTo(0.7, 2)
    expect(a.monthlyMarginCents).toBeGreaterThan(b.monthlyMarginCents as number)
  })

  it('uses the category margin instead of the default', () => {
    const params = mergePricingParameters(PARAMS, { margin: { categories: { Combos: { targetBps: 3000, minimumBps: 3000 } } } })
    const result = computePrice(base({ category: 'Combos', params }))

    expect(result.targetMargin).toBe(0.3)
    expect(result.marginFromCategory).toBe(true)
  })
})

describe('insufficient data', () => {
  it.each([
    ['no cost', { costCents: null }, 'Sem custo cadastrado'],
    ['unreliable cost', { costFlaggedUnreliable: true }, 'Custo marcado como não confiável'],
    ['stale cost', { costAgeDays: 400, costFromPurchase: false }, 'Custo desatualizado'],
    ['no loss history', { loss: null }, 'Sem histórico de perda'],
    ['no payment mix', { payment: null }, 'Sem vendas'],
    ['no operating share', { operatingShare: null }, 'Rateio operacional'],
  ])('%s gives no recommendation', (_name, override, reason) => {
    const result = computePrice(base(override as Partial<PriceInput>))

    expect(result.status).toBe('insufficient_data')
    expect(result.confidence).toBe('insufficient_data')
    expect(result.recommendedPriceCents).toBeNull()
    expect(result.insufficientReasons.join(' ')).toContain(reason)
  })

  it('trusts an old cost version when the product was bought in the period', () => {
    const result = computePrice(base({ costAgeDays: 400, costFromPurchase: true }))

    expect(result.status).not.toBe('insufficient_data')
  })

  it('refuses to recommend without a configured tax rate', () => {
    const result = computePrice(base({ params: DEFAULT_PRICING_PARAMETERS }))

    expect(result.status).toBe('insufficient_data')
    expect(result.insufficientReasons.join(' ')).toContain('Alíquota')
  })

  it('reports a structure that eats the whole margin as review, without prices', () => {
    const result = computePrice(base({ operatingShare: 0.7 }))

    expect(result.status).toBe('review')
    expect(result.recommendedPriceCents).toBeNull()
  })
})

describe('confidence', () => {
  const strong = (overrides: Partial<PriceInput> = {}) => base({ monthlyUnits: 100, previousCostCents: null, loss: { rate: 0.02, level: 'category' }, ...overrides })

  it('is high with fresh purchase cost, volume, a complete weighted payment mix', () => {
    expect(computePrice(strong()).confidence).toBe('high')
  })

  it('drops when the voucher fee is a simple average', () => {
    expect(computePrice(strong({ payment: payment({ voucherBasis: 'simple_average' }) })).confidence).toBe('medium')
  })

  it('is not high with few sales', () => {
    expect(computePrice(strong({ monthlyUnits: 3 })).confidence).toBe('low')
  })

  it('withholds the price below the configured minimum confidence', () => {
    const params = mergePricingParameters(PARAMS, { minConfidence: 'high' })
    const result = computePrice(strong({ monthlyUnits: 3, params }))

    expect(result.recommendedPriceCents).toBeNull()
    expect(result.status).toBe('review')
    expect(result.reasons.map(reason => reason.code)).toContain('below_min_confidence')
  })
})

describe('shapePrice', () => {
  it('rounds up to the step', () => expect(shapePrice(607.15, PARAMS)).toBe(610))
  it('applies a psychological ending when enabled', () => {
    const params = mergePricingParameters(PARAMS, { psychological: { enabled: true, endingCents: 90 } })

    expect(shapePrice(607.15, params)).toBe(690)
    expect(shapePrice(691, params)).toBe(790)
  })
})

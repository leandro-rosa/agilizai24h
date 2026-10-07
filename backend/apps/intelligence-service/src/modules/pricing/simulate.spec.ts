import { assertPrice, InvalidPriceError, simulate } from './simulate'
import { computePrice, type PriceInput } from './price'
import { DEFAULT_PRICING_PARAMETERS, mergePricingParameters } from './pricing.parameters'

const params = mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { taxRateBps: 707 })
const base = (overrides: Partial<PriceInput> = {}): PriceInput => ({
  sku: 'COCA',
  category: 'beverage',
  costCents: 309,
  costAgeDays: 10,
  costFromPurchase: true,
  costFlaggedUnreliable: false,
  previousCostCents: 280,
  currentPriceCents: 590,
  monthlyUnits: 325,
  volumeDroppedAfterPriceChange: false,
  loss: { rate: 0.02, level: 'product' },
  payment: { rate: 0.02, fixedPerUnitCents: 10, components: [], voucherShare: 0.22, voucherBasis: 'sales_weighted', unresolvedShare: 0, complete: true, notes: [] },
  operatingShare: 0.04,
  params,
  ...overrides,
})

describe('simulate', () => {
  it('gives the same margin as the engine at the same price', () => {
    const result = computePrice(base())
    const sim = simulate({ structure: result.structure, currentPriceCents: 590, monthlyUnits: 325, targetMargin: 0.35, priceCents: result.recommendedPriceCents as number })

    expect(sim.simulable).toBe(true)
    expect(sim.simulable && sim.margin).toBeCloseTo(result.recommendedMargin as number, 10)
    expect(sim.simulable && sim.monthlyImpactCents).toBeCloseTo(result.impactCentsPerMonth as number, 6)
  })

  it('simulating the current price has no impact and the current margin', () => {
    const result = computePrice(base())
    const sim = simulate({ structure: result.structure, currentPriceCents: 590, monthlyUnits: 325, targetMargin: 0.35, priceCents: 590 })

    expect(sim.simulable && sim.monthlyImpactCents).toBeCloseTo(0, 8)
    expect(sim.simulable && sim.margin).toBeCloseTo(result.currentMargin as number, 10)
  })

  it('answers what if R$ 6,50: margin, markup, unit profit, impact and gap to the target', () => {
    const result = computePrice(base())
    const sim = simulate({ structure: result.structure, currentPriceCents: 590, monthlyUnits: 325, targetMargin: 0.35, priceCents: 650 })
    if (!sim.simulable) throw new Error('should simulate')

    // variable share 0.1307, unit cost 309/0.98 + 10 = 325.306
    expect(sim.unitProfitCents).toBeCloseTo(650 * 0.8693 - (309 / 0.98 + 10), 6)
    expect(sim.margin).toBeCloseTo(sim.unitProfitCents / 650, 10)
    expect(sim.markup).toBeCloseTo(650 / 309, 10)
    expect(sim.differenceToTarget).toBeCloseTo(sim.margin - 0.35, 10)
    expect(sim.monthlyImpactCents).toBeGreaterThan(0)
    expect(sim.impactLabel).toBe('Impacto potencial estimado')
  })

  it('says a product without a structure cannot be simulated, with no invented figures', () => {
    const sim = simulate({ structure: null, currentPriceCents: 590, monthlyUnits: 10, targetMargin: 0.35, priceCents: 650 })

    expect(sim).toMatchObject({ simulable: false })
    expect(sim).not.toHaveProperty('margin')
  })

  it('says a product without a current price cannot be simulated', () => {
    expect(simulate({ structure: computePrice(base()).structure, currentPriceCents: null, monthlyUnits: 10, targetMargin: 0.35, priceCents: 650 }).simulable).toBe(false)
  })
})

describe('assertPrice', () => {
  it('accepts a positive whole number of centavos', () => expect(assertPrice(650)).toBe(650))
  it.each([[0], [-1], [6.5], ['650'], [null], [undefined], [NaN]])('rejects %p', value => {
    expect(() => assertPrice(value)).toThrow(InvalidPriceError)
  })
})

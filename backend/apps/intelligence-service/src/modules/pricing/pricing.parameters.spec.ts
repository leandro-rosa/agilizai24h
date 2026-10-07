import { DEFAULT_PRICING_PARAMETERS, marginsFor, mergePricingParameters, PricingParametersInvalidError, validatePricingParameters } from './pricing.parameters'

describe('pricing parameters', () => {
  it('starts with the 35% reference target and no tax rate', () => {
    expect(DEFAULT_PRICING_PARAMETERS.margin.targetBps).toBe(3500)
    expect(DEFAULT_PRICING_PARAMETERS.taxRateBps).toBeNull()
    expect(validatePricingParameters(DEFAULT_PRICING_PARAMETERS)).toEqual([])
  })

  it('merges a change without touching the base', () => {
    const next = mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { margin: { targetBps: 3800 } })

    expect(next.margin.targetBps).toBe(3800)
    expect(next.margin.minimumBps).toBe(3000)
    expect(DEFAULT_PRICING_PARAMETERS.margin.targetBps).toBe(3500)
  })

  it('maps Sodexo to Pluxee by default', () => {
    expect(DEFAULT_PRICING_PARAMETERS.payment.brandAliases).toEqual({ sodexo: 'pluxee' })
  })

  it('refuses an unknown parameter', () => {
    expect(() => mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { margim: {} } as never)).toThrow(PricingParametersInvalidError)
    expect(() => mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { margin: { nope: 1 } } as never)).toThrow(PricingParametersInvalidError)
  })

  it('reports every problem at once', () => {
    const bad = mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { margin: { targetBps: 2000, minimumBps: 3000 }, rounding: { stepCents: 0 } })

    expect(validatePricingParameters(bad).length).toBeGreaterThanOrEqual(2)
  })

  it('uses the category override instead of the default', () => {
    const p = mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { margin: { categories: { Combos: { minimumBps: 3000, targetBps: 3000 } } } })

    expect(marginsFor(p, 'Combos')).toEqual({ target: 0.3, minimum: 0.3, fromCategory: true })
    expect(marginsFor(p, 'Bebidas')).toEqual({ target: 0.35, minimum: 0.3, fromCategory: false })
  })
})

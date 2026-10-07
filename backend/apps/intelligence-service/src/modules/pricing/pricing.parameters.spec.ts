import { withPricingDefaults } from './pricing-parameters.service'
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

  it('maps Sodexo to Pluxee and PagSeguro to PagBank by default', () => {
    expect(DEFAULT_PRICING_PARAMETERS.payment.brandAliases).toEqual({ sodexo: 'pluxee', pagseguro: 'pagbank' })
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

  it('proposes a class for each real account, leaves Marketing and Degustações for the owner, and keeps coffee break and fruit out of the price', () => {
    const behavior = DEFAULT_PRICING_PARAMETERS.operating.accountBehavior

    expect(behavior['4.2.01']).toBe('percent_of_sales')
    expect(behavior['4.2.03']).toBe('per_visit')
    expect(behavior['4.1.02']).toBe('other_revenue_cost')
    expect(behavior['4.1.03']).toBe('other_revenue_cost')
    expect(behavior['4.2.07']).toBeUndefined()
    expect(behavior['4.2.06']).toBeUndefined()
    expect(DEFAULT_PRICING_PARAMETERS.operating.unclassifiedRelevantBps).toBe(50)
  })

  it('replaces the account map as a whole and validates the result', () => {
    const next = mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { operating: { accountBehavior: { '4.2.07': 'fixed' } } })

    expect(next.operating.accountBehavior).toEqual({ '4.2.07': 'fixed' })
    expect(DEFAULT_PRICING_PARAMETERS.operating.accountBehavior['4.2.01']).toBe('percent_of_sales')
    expect(validatePricingParameters(next)).toEqual([])
  })

  it('a version stored before the classification existed is read with the proposal filling the gap', () => {
    const { operating: _omitted, ...stored } = DEFAULT_PRICING_PARAMETERS

    expect(withPricingDefaults(stored).operating.accountBehavior['4.2.01']).toBe('percent_of_sales')
  })
})

import { computePrice, type PriceInput } from './price'
import { suggestNewProduct, NEW_PRODUCT_LABEL, type NewProductInput } from './new-product'
import { DEFAULT_PRICING_PARAMETERS, mergePricingParameters } from './pricing.parameters'
import type { PaymentCost } from './pricing.types'

const payment: PaymentCost = { rate: 0.02, fixedPerUnitCents: 0, components: [], voucherShare: 0.22, voucherBasis: 'sales_weighted', unresolvedShare: 0, complete: true, notes: [], }
const PARAMS = mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { taxRateBps: 707 })

// Same hand-computed fixture as price.spec: cost 309, tax 7.07%, payment 2%, operating 4%, loss 2% => target 607.15 => 610.
const input = (over: Partial<NewProductInput> = {}): NewProductInput => ({
  sku: '110024', name: 'Novo sabor de marmita', category: 'meal', costCents: 309, costAgeDays: 0, costFromPurchase: true, costFlaggedUnreliable: false,
  monthlyUnits: 0, loss: { rate: 0.02, level: 'category' }, payment, operatingShare: 0.04, params: PARAMS, costOrigin: 'Nota fiscal 13021', costNotReceived: false, ...over,
})

describe('suggestNewProduct', () => {
  it('suggests the target price, labelled as a new product, with reduced confidence', () => {
    const result = suggestNewProduct(input())

    expect(result.status).toBe('suggested')
    expect(result.label).toBe(NEW_PRODUCT_LABEL)
    expect(result.confidence).toBe('low')
    expect(result.suggestedPriceCents).toBe(610)
    expect(result.suggestedMargin).toBeGreaterThanOrEqual(result.targetMargin - 0.005)
  })

  it('uses the same engine: the suggestion is the target price a product with the same cost structure gets', () => {
    const asProduct: PriceInput = { ...input(), currentPriceCents: 590, previousCostCents: null, volumeDroppedAfterPriceChange: false, monthlyUnits: 325 }

    expect(suggestNewProduct(input()).suggestedPriceCents).toBe(computePrice(asProduct).targetPriceCents)
    expect(suggestNewProduct(input()).minimumPriceCents).toBe(computePrice(asProduct).minimumPriceCents)
  })

  it('lists the data it used with their origin, including where the cost came from', () => {
    const used = suggestNewProduct(input()).dataUsed

    expect(used.map(d => d.code)).toEqual(['cost', 'category', 'tax', 'payment', 'loss', 'operating', 'margin', 'rounding'])
    expect(used[0]).toMatchObject({ value: 'R$ 3,09', origin: 'Nota fiscal 13021' })
    expect(used.find(d => d.code === 'loss')?.origin).toContain('categoria')
  })

  it('says the cost is from an invoice not received yet', () => {
    expect(suggestNewProduct(input({ costNotReceived: true })).reasons.join(' ')).toContain('ainda não recebida')
  })

  it('a product that sold a little gets another label but is still low confidence', () => {
    const result = suggestNewProduct(input({ monthlyUnits: 12 }))

    expect(result.label).toBe('Produto com poucas vendas')
    expect(result.confidence).toBe('low')
  })

  it.each([
    ['cost', { costCents: null }],
    ['tax', { params: DEFAULT_PRICING_PARAMETERS }],
    ['payment', { payment: null }],
    ['loss', { loss: null }],
    ['operating', { operatingShare: null }],
  ])('without %s it gives no price and says why', (_name, over) => {
    const result = suggestNewProduct(input(over as Partial<NewProductInput>))

    expect(result.status).toBe('insufficient_data')
    expect(result.suggestedPriceCents).toBeNull()
    expect(result.insufficientReasons).toHaveLength(1)
  })
})

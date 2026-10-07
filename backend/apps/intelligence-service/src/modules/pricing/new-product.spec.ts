import { computePrice, type PriceInput } from './price'
import { suggestNewProduct, NEW_PRODUCT_LABEL, type NewProductInput } from './new-product'
import { DEFAULT_PRICING_PARAMETERS, mergePricingParameters } from './pricing.parameters'
import type { PaymentCost } from './pricing.types'

const payment: PaymentCost = { rate: 0.02, fixedPerUnitCents: 0, components: [], voucherShare: 0.22, voucherBasis: 'sales_weighted', unresolvedShare: 0, complete: true, notes: [], }
const PARAMS = mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { taxRateBps: 707 })

// Same hand-computed fixture as price.spec: cost 309, tax 7.07%, payment 2%, operating 4%, loss 2% => target 607.15 => 610.
const input = (over: Partial<NewProductInput> = {}): NewProductInput => ({
  sku: '110024', name: 'Novo sabor de marmita', category: 'meal', costCents: 309, costAgeDays: 0, costFromPurchase: true, costFlaggedUnreliable: false,
  monthlyUnits: 0, loss: { rate: 0.02, level: 'category' }, payment, operatingShare: 0.04, params: PARAMS, costLabel: 'Nota fiscal 13021', costNotReceived: false, ...over,
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

describe('suggestNewProduct — classification and the unreachable target', () => {
  const context = { perVisitShare: 0.01, fixedShare: 0.04, complete: true, unclassifiedCents: 0, unclassifiedShare: 0, unclassified: [], months: ['2026-09'], perTransactionAssumption: null, scope: 'rede', legacyShare: 0.07, shifts: [], perTransactionLegacyShare: 0 }

  it('is validated only with a complete classification, and says what is missing otherwise', () => {
    expect(suggestNewProduct(input({ operating: context })).validated).toBe(true)
    expect(suggestNewProduct(input()).validated).toBe(false)

    const incomplete = suggestNewProduct(input({ operating: { ...context, complete: false, unclassifiedCents: 90_000, unclassifiedShare: 0.03, unclassified: [{ code: '4.2.07', label: 'Marketing', amountCents: 90_000 }] } }))
    expect(incomplete.validated).toBe(false)
    expect(incomplete.validationNotes.join(' ')).toContain('Cálculo incompleto: R$ 900,00')
    expect(incomplete.suggestedPriceCents).toBe(610) // still shown, never as validated
  })

  it('a per-transaction cost per unit raises the suggestion and is listed in the data used, with its hypothesis in the notes', () => {
    const plain = suggestNewProduct(input({ operating: context }))
    const withTransaction = suggestNewProduct(input({ operating: { ...context, perTransactionAssumption: 'Cada linha de venda conta como um ticket' }, perTransactionPerUnitCents: 20 }))

    expect(withTransaction.suggestedPriceCents as number).toBeGreaterThan(plain.suggestedPriceCents as number)
    expect(withTransaction.dataUsed.find(d => d.code === 'operating')?.value).toContain('R$ 0,20 por unidade')
    expect(withTransaction.validationNotes).toContain('Cada linha de venda conta como um ticket')
  })

  it('gives no price, and says the target is not reachable by the formula, when the percentages leave no room for the margin', () => {
    const result = suggestNewProduct(input({ operatingShare: 0.6, operating: context }))

    expect(result.status).toBe('insufficient_data')
    expect(result.suggestedPriceCents).toBeNull()
    expect(result.insufficientReasons[0]).toMatch(/não é alcançável pela fórmula/)
  })
})

import { computePrice, shapePrice, solveStructure, type OperatingContext, type PriceInput } from './price'
import { marginsFor } from './pricing.parameters'
import { DEFAULT_PRICING_PARAMETERS, mergePricingParameters } from './pricing.parameters'
import { ANALYSIS_ONLY_STATEMENT, type PaymentCost } from './pricing.types'

const payment = (overrides: Partial<PaymentCost> = {}): PaymentCost => ({ rate: 0.02, fixedPerUnitCents: 0, components: [], voucherShare: 0.22, voucherBasis: 'sales_weighted', unresolvedShare: 0, complete: true, notes: [], ...overrides })

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

describe('cost change impact on margin', () => {
  it('shows the margin at the previous cost and the drop the cost rise caused', () => {
    const result = computePrice(base({ costCents: 309, previousCostCents: 280 }))

    // variable share 0.1307, loss 2%: margin at price 590 = (590 * 0.8693 - cost / 0.98) / 590
    const at = (cost: number) => (590 * 0.8693 - cost / 0.98) / 590
    expect(result.marginAtPreviousCost).toBeCloseTo(at(280), 6)
    expect(result.currentMargin).toBeCloseTo(at(309), 6)
    expect(result.marginChangeFromCost).toBeCloseTo(at(309) - at(280), 6)
    expect(result.marginChangeFromCost as number).toBeLessThan(0)
  })

  it('has no impact without a previous cost', () => {
    expect(computePrice(base({ previousCostCents: null })).marginChangeFromCost).toBeNull()
  })
})

describe('category label', () => {
  it('uses the Portuguese label and falls back to Outros for an unknown key', () => {
    expect(computePrice(base({ category: 'beverage' })).categoryLabel).toBe('Bebidas')
    expect(computePrice(base({ category: 'frozen' })).categoryLabel).toBe('Outros')
    expect(computePrice(base({ category: null })).categoryLabel).toBe('Outros')
  })
})

describe('fixed fee per sale', () => {
  it('raises the target price and shows up in the structure', () => {
    const without = computePrice(base())
    const withFixed = computePrice(base({ payment: payment({ fixedPerUnitCents: 20 }) }))

    // 20 cents per sold unit / (1 - 0.1307 - 0.35) = +38.5 cents on the raw target
    expect(withFixed.structure?.paymentFixedCents).toBe(20)
    expect((withFixed.targetPriceCents as number) - (without.targetPriceCents as number)).toBeGreaterThanOrEqual(30)
    expect(withFixed.currentMargin as number).toBeLessThan(without.currentMargin as number)
  })

  it('is not multiplied by the loss rate: lost units are never sold', () => {
    const result = computePrice(base({ loss: { rate: 0.12, level: 'product' }, payment: payment({ fixedPerUnitCents: 20 }) }))

    expect(result.structure?.lossAdjustedCostCents).toBeCloseTo(309 / 0.88, 6)
    expect(result.structure?.paymentFixedCents).toBe(20)
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

describe('computePrice — the real origin of the cost', () => {
  const origin = (source: string, extra: Partial<{ effectiveFrom: string; invoiceNumber: string | null }> = {}) => ({ source, effectiveFrom: '2026-09-10', invoiceNumber: source === 'invoice' ? '13021' : null, ...extra })

  it('carries the origin of the cost into the result so the screen can say where the number came from', () => {
    expect(computePrice(base({ costOrigin: origin('invoice') })).costOrigin).toEqual({ source: 'invoice', effectiveFrom: '2026-09-10', invoiceNumber: '13021' })
    expect(computePrice(base()).costOrigin).toBeNull()
    expect(computePrice(base({ costCents: null, costOrigin: origin('manual') })).costOrigin).toMatchObject({ source: 'manual' })
  })

  it('a cost proven by an invoice earns more confidence than a typed one, whatever was bought in the window', () => {
    // Same product, same sales, same fees: only the backing of the cost changes (hand-checked against the rubric: 8 points = high, 7 = medium).
    const same = { monthlyUnits: 20, previousCostCents: null }
    const invoice = computePrice(base({ ...same, costFromPurchase: false, costOrigin: origin('invoice') }))
    const typed = computePrice(base({ ...same, costFromPurchase: true, costOrigin: origin('manual') }))

    expect(invoice.confidence).toBe('high')
    // With the origin known, a purchase seen in the window no longer stands in for it.
    expect(typed.confidence).toBe('medium')
  })

  it('without an origin it keeps using the purchase seen in the window', () => {
    const bought = computePrice(base({ costFromPurchase: true, costOrigin: null }))
    const notBought = computePrice(base({ costFromPurchase: false, costOrigin: null, costAgeDays: 10 }))

    expect(rank(bought.confidence)).toBeGreaterThanOrEqual(rank(notBought.confidence))
  })
})

const rank = (confidence: string) => ['insufficient_data', 'low', 'medium', 'high'].indexOf(confidence)


describe('solveStructure — percentages in the denominator, money in the numerator', () => {
  const margins = { target: 0.35, minimum: 0.3, fromCategory: false }
  const solve = (extra: Partial<{ operatingShare: number; perTransactionPerUnitCents: number; taxRateBps: number; payment: PaymentCost }> = {}) =>
    solveStructure({ costCents: 309, taxRateBps: 707, payment: payment(), loss: { rate: 0.02, level: 'product' }, operatingShare: 0.04, ...extra }, margins)

  it('adds the per-transaction cost to the numerator without the loss: price = (cost/(1-loss) + per-transaction) / (1 - % - margin)', () => {
    const without = solve()
    const withTransaction = solve({ perTransactionPerUnitCents: 20 })

    // Hand-computed: numerator 309/0.98 + 20 = 335.3061; denominator 1 - 0.0707 - 0.02 - 0.04 - 0.35 = 0.5193.
    expect(without.rawTarget).toBeCloseTo(315.3061 / 0.5193, 3)
    expect(withTransaction.rawTarget).toBeCloseTo(335.3061 / 0.5193, 3)
    // The 20 cents are NOT multiplied by 1/(1-loss) (a lost unit is never sold, so it never pays a transaction cost).
    expect(withTransaction.unitCost - without.unitCost).toBeCloseTo(20, 10)
    expect(withTransaction.structure.perTransactionCents).toBe(20)
    // …and they are money, not a share of the price: the percentages did not move.
    expect(withTransaction.variableShare).toBeCloseTo(without.variableShare, 12)
  })

  it('moves the contribution margin: a per-transaction cost lowers it by cost/price in points', () => {
    const withTransaction = solve({ perTransactionPerUnitCents: 20 })
    const without = solve()

    expect(without.marginAt(600) - withTransaction.marginAt(600)).toBeCloseTo(20 / 600, 10)
  })

  it('the percentage-of-sales share comes off the price, so it changes the denominator, not the numerator', () => {
    const low = solve({ operatingShare: 0.02 })
    const high = solve({ operatingShare: 0.1 })

    expect(low.unitCost).toBeCloseTo(high.unitCost, 12)
    expect(high.rawTarget as number).toBeGreaterThan(low.rawTarget as number)
  })

  it('says the target is not reachable when the percentages and the margin reach 100%, zero or beyond', () => {
    // 7.07% + payment 2% + operating 0.5593 + target 35% = 100% exactly would be a zero denominator; use clear cases on both sides.
    const zero = solve({ operatingShare: 1 - 0.0707 - 0.02 - 0.35, taxRateBps: 707 })
    const negative = solve({ operatingShare: 0.6 })

    for (const solved of [zero, negative]) {
      expect(solved.rawTarget).toBeNull()
      expect(solved.unreachable).toMatch(/A meta de 35,0% não é alcançável pela fórmula.*somam .* do preço e, com a meta, passam de 100%/)
    }
    expect(solve().unreachable).toBeNull()
  })

  it('never returns a price or a division by zero when the denominator is not positive', () => {
    const result = computePrice(base({ operatingShare: 0.6 }))

    expect(result.status).toBe('review')
    expect(result.targetPriceCents).toBeNull()
    expect(result.recommendedPriceCents).toBeNull()
    expect(result.minimumPriceCents).toBeNull()
    expect(result.insufficientReasons.join(' ')).toContain('não é alcançável pela fórmula')
    // The contribution at the current price is still reported: it is a fact about today's price.
    expect(result.unitContributionCents).not.toBeNull()
  })
})

describe('computePrice — the three numbers and the validation', () => {
  const context = (over: Partial<OperatingContext> = {}): OperatingContext => ({
    perVisitShare: 0.01,
    fixedShare: 0.04,
    complete: true,
    unclassifiedCents: 0,
    unclassifiedShare: 0,
    unclassified: [],
    months: ['2026-09'],
    perTransactionAssumption: null,
    scope: 'rede',
    legacyShare: 0.07, // 2% percentage + 1% deslocamento + 4% fixed
    shifts: [
      { class: 'per_visit', label: 'Deslocamento por visita saiu do preço (viabilidade da rota ou loja)', share: 0.01 },
      { class: 'fixed', label: 'Custos fixos saíram do preço (resultado operacional e ponto de equilíbrio)', share: 0.04 },
    ],
    perTransactionLegacyShare: 0,
    ...over,
  })

  it('reports the contribution margin, the contribution per unit and the result after allocation, which is not the margin the target applies to', () => {
    const result = computePrice(base({ operating: context() }))
    const margin = 590 * (1 - 0.0707 - 0.02 - 0.04) - 309 / 0.98

    expect(result.unitContributionCents).toBeCloseTo(margin, 8)
    expect(result.currentMargin).toBeCloseTo(margin / 590, 8)
    expect(result.estimatedResultAfterAllocation?.centsPerUnit).toBeCloseTo(margin - 590 * 0.05, 8)
    expect(result.estimatedResultAfterAllocation?.margin).toBeCloseTo(margin / 590 - 0.05, 8)
    expect(result.estimatedResultAfterAllocation?.criterion).toContain('não o lucro líquido')
  })

  it('is validated only with a complete classification', () => {
    expect(computePrice(base({ operating: context() })).validated).toBe(true)
    expect(computePrice(base()).validated).toBe(false) // classification unknown
    const incomplete = computePrice(base({ operating: context({ complete: false, unclassifiedCents: 90_000, unclassifiedShare: 0.03, unclassified: [{ code: '4.2.07', label: 'Marketing', amountCents: 90_000 }] }) }))

    expect(incomplete.validated).toBe(false)
    expect(incomplete.validationNotes.join(' ')).toContain('Cálculo incompleto: R$ 900,00')
    expect(incomplete.validationNotes.join(' ')).toContain('4.2.07 Marketing')
    expect(incomplete.recommendedPriceCents).not.toBeNull()
  })

  it('a per-transaction cost lowers the contribution and raises the target price', () => {
    const plain = computePrice(base({ operating: context() }))
    const withTransaction = computePrice(base({ operating: context(), perTransactionPerUnitCents: 20 }))

    expect((withTransaction.unitContributionCents as number) - (plain.unitContributionCents as number)).toBeCloseTo(-20, 8)
    expect(withTransaction.targetPriceCents as number).toBeGreaterThan(plain.targetPriceCents as number)
  })
})

describe('marginsFor still reads the target as the contribution target', () => {
  it('keeps 35% and 30% as the references', () => {
    expect(marginsFor(PARAMS, null)).toEqual({ target: 0.35, minimum: 0.3, fromCategory: false })
  })
})

describe('computePrice — reconciliation with the previous model', () => {
  const ctx = (over: Partial<OperatingContext> = {}): OperatingContext => ({
    perVisitShare: 0.01, fixedShare: 0.04, complete: true, unclassifiedCents: 0, unclassifiedShare: 0, unclassified: [], months: ['2026-09'], perTransactionAssumption: null, scope: 'rede',
    legacyShare: 0.07,
    shifts: [
      { class: 'per_visit', label: 'Deslocamento por visita saiu do preço (viabilidade da rota ou loja)', share: 0.01 },
      { class: 'fixed', label: 'Custos fixos saíram do preço (resultado operacional e ponto de equilíbrio)', share: 0.04 },
    ],
    perTransactionLegacyShare: 0,
    ...over,
  })

  it('the old margin is the old formula (every expense in the share) and each difference is a line that adds up', () => {
    const result = computePrice(base({ operatingShare: 0.02, operating: ctx() }))
    const old = (590 * (1 - 0.0707 - 0.02 - 0.07) - 309 / 0.98) / 590
    const reconciliation = result.reconciliation!

    expect(reconciliation.oldMargin).toBeCloseTo(old, 10)
    expect(reconciliation.newMargin).toBeCloseTo(result.currentMargin as number, 10)
    expect(reconciliation.lines.map(line => [line.label.slice(0, 11), line.points])).toEqual([['Deslocament', 0.01], ['Custos fixo', 0.04]])
    expect(reconciliation.unexplainedPoints).toBeCloseTo(0, 10)
    expect(reconciliation.newMargin - reconciliation.oldMargin).toBeCloseTo(0.05, 10)
  })

  it('a per-transaction cost shows as the change of base: share of revenue before, money per unit now', () => {
    // 1% of revenue was in the old share; now it is 6 cents per unit at a price of 590 (= 1.017%).
    const result = computePrice(base({ operatingShare: 0.02, perTransactionPerUnitCents: 6, operating: ctx({ legacyShare: 0.08, perTransactionLegacyShare: 0.01 }) }))
    const reconciliation = result.reconciliation!
    const change = reconciliation.lines.find(line => line.label.startsWith('Custo por transação'))!

    expect(change.points).toBeCloseTo(0.01 - 6 / 590, 10)
    expect(reconciliation.unexplainedPoints).toBeCloseTo(0, 10)
  })

  it('shows what was removed for other activities, double counting and unclassified accounts, and "unexplained" stays zero', () => {
    const result = computePrice(
      base({
        operatingShare: 0.02,
        operating: ctx({
          legacyShare: 0.1,
          shifts: [
            { class: 'other_revenue_cost', label: 'Despesas de outras atividades (coffee break, frutas) removidas do preço', share: 0.015 },
            { class: 'already_component', label: 'Dupla contagem corrigida (já é imposto, taxa, perda ou compra)', share: 0.005 },
            { class: 'unclassified', label: 'Despesas sem classificação ficaram fora do preço (cálculo incompleto)', share: 0.01 },
            { class: 'fixed', label: 'Custos fixos saíram do preço', share: 0.05 },
          ],
        }),
      }),
    )

    expect(result.reconciliation?.lines).toHaveLength(4)
    expect(result.reconciliation?.unexplainedPoints).toBeCloseTo(0.08 - 0.08, 10)
  })

  it('reproduces the Monster of September by hand: 16,0% before, and the new contribution margin with each reason', () => {
    // Monster: price 1190, cost 570, loss 4,05%, tax 7,07%, payment 3,07% + 6,8¢ fixed, old share 23,35%.
    const result = computePrice(
      base({
        costCents: 570,
        currentPriceCents: 1190,
        loss: { rate: 0.0405, level: 'product' },
        payment: payment({ rate: 0.0307, fixedPerUnitCents: 6.8 }),
        operatingShare: 0.0145,
        operating: ctx({
          legacyShare: 0.2335,
          shifts: [{ class: 'fixed', label: 'Custos fixos saíram do preço (resultado operacional e ponto de equilíbrio)', share: 0.219 }],
        }),
      }),
    )
    const reconciliation = result.reconciliation!

    expect(reconciliation.oldMargin).toBeCloseTo(0.16, 2) // the figure the owner saw
    expect(reconciliation.newMargin).toBeCloseTo(0.16 + 0.219, 2)
    expect(reconciliation.unexplainedPoints).toBeCloseTo(0, 10)
  })
})

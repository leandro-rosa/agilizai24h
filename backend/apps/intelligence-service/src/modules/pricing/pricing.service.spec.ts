import { NullPurchaseSource } from '../analysis/purchase-source'
import type { PnlDto } from '../sources/accounting.client'
import { DEFAULT_PRICING_PARAMETERS, mergePricingParameters } from './pricing.parameters'
import { PricingService } from './pricing.service'

const MONTHS = ['2026-07', '2026-08', '2026-09']

const acct = (code: string, label: string, amount_cents: number) => ({ code, label, section: '', amount_cents, children: [] })

/** 2% of store revenue follows the sales (repasse), 4% is a fixed platform fee and 1% is deslocamento: only the 2% belongs to the price. */
const pnl = (period: string, extra: ReturnType<typeof acct>[] = []): PnlDto => ({
  period,
  store_id: null,
  sections: [
    { section: 'gross_revenue', amount_cents: 1_000_000, accounts: [acct('3.1.01', 'Vendas lojas', 1_000_000)] },
    { section: 'variable_expenses', amount_cents: 30_000, accounts: [acct('4.2.01', 'Repasse de vendas', 20_000), acct('4.2.03', 'Deslocamento', 10_000), ...extra] },
    { section: 'fixed_expenses', amount_cents: 40_000, accounts: [acct('4.3.01', 'Mensalidade touchpay', 40_000)] },
  ],
})

function build(taxRateBps: number | null, extraProducts: Record<string, unknown>[] = [], costsOverride?: (asOf: string, sources?: string[]) => unknown, options: { extraAccounts?: ReturnType<typeof acct>[]; patch?: Record<string, unknown>; visits?: { store_id: number; period: string; restocking_visits: number }[] | null; mixBySku?: { sku: string; method: string | null; acquirer: string | null; card_brand: string | null; receipt_lines: number; units: number; amount_paid_cents: number }[] } = {}) {
  const params = mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { taxRateBps, ...options.patch } as never)
  const supply = {
    // 4 restocking visits of store 1 in each month of the window, unless the test says otherwise (null = the supply service cannot be read).
    visitCounts: async () => {
      if (options.visits === null) throw new Error('supply down')
      return { from: MONTHS[0], to: MONTHS[2], unit: 'x', rows: options.visits ?? MONTHS.map(period => ({ store_id: 1, period, restocking_visits: 4, count_only_visits: 1 })) }
    },
    period: async () => ({ store_id: 1, period: 'x', restocks: [{ sku: 'COCA', quantity_restocked: 100 }], removals: [{ sku: 'COCA', reason: 'expired', counts_as_loss: true, quantity_removed: 2 }], adjustments: [] }),
  }
  const sales: Record<string, unknown> = {
    period: async () => [{ sku: 'COCA', quantity_sold: 100, revenue_cents: 59_000 }],
    paymentMix: async () => ({
      from: MONTHS[0],
      to: MONTHS[2],
      store_id: null,
      rows: [
        { method: 'Voucher', acquirer: 'x', card_brand: 'Alelo', receipt_lines: 100, units: 75, tickets: 100, lines_without_ticket_id: 0, amount_paid_cents: 2200 },
        { method: 'Pix', acquirer: 'PagBank', card_brand: null, receipt_lines: 100, units: 75, tickets: 100, lines_without_ticket_id: 0, amount_paid_cents: 4000 },
        { method: 'Débito', acquirer: 'PagBank', card_brand: null, receipt_lines: 100, units: 75, tickets: 100, lines_without_ticket_id: 0, amount_paid_cents: 2000 },
        { method: 'Crédito', acquirer: 'PagBank', card_brand: null, receipt_lines: 100, units: 75, tickets: 100, lines_without_ticket_id: 0, amount_paid_cents: 1800 },
      ],
      total_amount_paid_cents: 10_000,
      periods_without_transactions: [],
    }),
  }
  // The payment mix per product: COCA has plenty of sales of its own (its own mix is used); nothing is said about the others unless a test asks.
  const mixBySku = options.mixBySku ?? [
    { sku: 'COCA', method: 'Pix', acquirer: 'PagBank', card_brand: null, receipt_lines: 60, units: 70, amount_paid_cents: 30_000 },
    { sku: 'COCA', method: 'Voucher', acquirer: 'x', card_brand: 'Alelo', receipt_lines: 40, units: 40, amount_paid_cents: 29_000 },
  ]
  sales.paymentMixBySku = async () => ({ from: MONTHS[0], to: MONTHS[2], store_id: null, rows: mixBySku, periods_without_transactions: [] })
  const products = {
    categories: async () => [{ key: 'beverage', name: 'Bebida', status: 'active' }, { key: 'congelados', name: 'Congelados', status: 'active' }],
    products: async () => [
      { id: 1, sku: 'COCA', name: 'Coca-Cola Lata 350ml', category: 'beverage', subcategory: 'Refrigerantes', ean: '789490001537', supplier_id: 9 },
      { id: 2, sku: 'MARM', name: 'Marmita', category: 'meal' },
      ...extraProducts,
    ],
    costsAsOf: async (_skus: string[], asOf: string, _correlationId?: string, sources?: string[]) =>
      costsOverride?.(asOf, sources) ?? {
      as_of: asOf,
      resolved: [{ sku: 'COCA', product_id: 1, cost_cents: 309, effective_from: '2026-08-15', source: 'invoice', invoice_number: '13021' }],
      unresolved: [{ sku: 'MARM', reason: 'no_cost_before_date' }],
      complete: false,
    },
    pricesAsOf: async (_skus: string[], asOf: string) => ({
      resolved: [
        { sku: 'COCA', product_id: 1, price_cents: 590, effective_from: '2026-01-01' },
        { sku: 'MARM', product_id: 2, price_cents: 1890, effective_from: '2026-01-01' },
      ],
      unresolved: [],
      complete: true,
      asOf,
    }),
  }
  const stores = { stores: async () => [{ id: 1, name: 'Loja 1' }] }
  const treasury = {
    feesInForce: async (on: string) => ({
      on,
      rates: [
        { acquirer: 'PagBank', payment_method: 'pix', rate_bps: 69, effective_from: '2026-01-01' },
        { acquirer: 'PagBank', payment_method: 'debit', rate_bps: 139, effective_from: '2026-01-01' },
        { acquirer: 'PagBank', payment_method: 'credit', rate_bps: 297, effective_from: '2026-01-01' },
        { acquirer: 'Alelo', payment_method: 'voucher', rate_bps: 300, effective_from: '2026-01-01' },
        { acquirer: 'Ticket', payment_method: 'voucher', rate_bps: 350, effective_from: '2026-01-01' },
      ],
      methods_without_rate: [],
    }),
  }
  const accounting = { pnl: async (period: string) => pnl(period, options.extraAccounts) }
  const suppliers = { suppliers: async () => [{ id: 9, name: 'Coca-Cola FEMSA' }] }
  const parameters = { current: async () => ({ id: 7, createdAt: '', note: null, values: params }) }

  return new PricingService(supply as never, sales as never, products as never, stores as never, treasury as never, accounting as never, suppliers as never, new NullPurchaseSource(), parameters as never)
}

describe('PricingService.report', () => {
  it('builds the cost structure from the owning services and recommends', async () => {
    const report = await build(707).report({ period: '2026-09' })
    const coca = report.products.find(product => product.sku === 'COCA')!

    expect(report.meta.months).toEqual(MONTHS)
    expect(report.meta.parameterVersion).toBe(7)
    expect(report.meta.asOf).toBe('2026-09-30')
    expect(coca.structure).toMatchObject({ taxRate: 0.0707, lossRate: 0.02, lossLevel: 'product', operatingShare: 0.02 })
    // COCA has 100 receipt lines of its own (Pix 60% / voucher 40% of its revenue): ITS mix weighs the fees, not the network's (voucher alone 0,22 of the network).
    expect(coca.structure?.paymentRate).toBeCloseTo(0.019483, 6)
    expect(coca.structure?.paymentLevel).toBe('product')
    expect(coca.structure?.voucherShare).toBeCloseTo(29_000 / 59_000, 6)
    expect(coca.monthlyUnits).toBe(100)
    expect(coca.monthlyRevenueCents).toBe(59_000)
    // At R$ 5,90 the CONTRIBUTION margin is ~35.7%: just above the 35% target and with good volume, so it is a small-step opportunity (under the old
    // economic margin, which also charged deslocamento and fixed costs, this same product read as "below target").
    expect(coca.status).toBe('opportunity')
    expect(coca.currentMargin).toBeGreaterThan(0.35)
    expect(coca.recommendedPriceCents).toBeGreaterThan(590)
  })

  it('with an as-of day, values cost and price in force THAT day (the current basis) and says so; without it, the last day of the period', async () => {
    const asked: { costs: string[]; prices: string[] } = { costs: [], prices: [] };
    const service = build(707, [], (asOf: string) => {
      asked.costs.push(asOf)
      const cents = asOf >= '2026-10-01' ? 350 : 309

      return { as_of: asOf, resolved: [{ sku: 'COCA', product_id: 1, cost_cents: cents, effective_from: asOf >= '2026-10-01' ? '2026-10-05' : '2026-08-15', source: 'invoice', invoice_number: '13021' }], unresolved: [{ sku: 'MARM', reason: 'no_cost_before_date' }], complete: false }
    })

    const period = await service.report({ period: '2026-09' })
    const current = await service.report({ period: '2026-09', asOf: '2026-10-08' })
    const coca = (report: typeof period) => report.products.find(product => product.sku === 'COCA')!

    expect(period.meta).toMatchObject({ basis: 'period', asOf: '2026-09-30' })
    expect(current.meta).toMatchObject({ basis: 'current', asOf: '2026-10-08' })
    expect(current.meta.months).toEqual(MONTHS)
    expect(coca(period).structure?.productCostCents).toBe(309)
    // The cost bought on 05/10 is already the cost of the current basis, and it is not reported as a "newer cost" (it IS the cost in force).
    expect(coca(current).structure?.productCostCents).toBe(350)
    expect(coca(current).newerCost ?? null).toBeNull()
    expect(coca(current).currentMargin).toBeLessThan(coca(period).currentMargin as number)
    expect(asked.costs).toContain('2026-10-08')
  })

  it('simulates a typed price over the current basis of a product, with today\'s cost, and refuses a bad price or an unknown product', async () => {
    const service = build(707, [], (asOf: string) => ({ as_of: asOf, resolved: [{ sku: 'COCA', product_id: 1, cost_cents: asOf >= '2026-10-01' ? 350 : 309, effective_from: '2026-08-15', source: 'invoice', invoice_number: '13021' }], unresolved: [{ sku: 'MARM', reason: 'no_cost_before_date' }], complete: false }))
    const today = '2026-10-08'
    const atCurrent = await service.simulateCurrent('COCA', { priceCents: 700, asOf: today })
    const atPeriod = await service.simulateCurrent('COCA', { priceCents: 700, asOf: '2026-09-30' })

    expect(atCurrent).toMatchObject({ simulable: true, reportRunId: 'current', priceCents: 700 })
    expect((atCurrent as { margin: number }).margin).toBeLessThan((atPeriod as { margin: number }).margin)
    await expect(service.simulateCurrent('COCA', { priceCents: -5, asOf: today })).rejects.toThrow()
    await expect(service.simulateCurrent('NOPE', { priceCents: 700, asOf: today })).rejects.toThrow(/not found/)
  })

  it('carries the identity the table needs, and none for a product without a supplier', async () => {
    const report = await build(707).report({ period: '2026-09' })
    const coca = report.products.find(product => product.sku === 'COCA')!
    const marmita = report.products.find(product => product.sku === 'MARM')!

    expect(coca).toMatchObject({ ean: '789490001537', supplierId: 9, supplierName: 'Coca-Cola FEMSA', category: 'beverage', categoryLabel: 'Bebida', subcategory: 'Refrigerantes' })
    expect(marmita).toMatchObject({ ean: null, supplierId: null, supplierName: null, categoryLabel: 'Refeições' }) // 'meal' is not in the registry fixture: the built-in label is the fallback
  })

  it('gives no recommendation to a product without a cost and counts it', async () => {
    const report = await build(707).report({ period: '2026-09' })
    const marmita = report.products.find(product => product.sku === 'MARM')!

    expect(marmita.status).toBe('insufficient_data')
    expect(marmita.recommendedPriceCents).toBeNull()
    expect(report.summary.insufficientData).toBe(1)
    expect(report.summary.analysed).toBe(2)
  })

  it('refuses to recommend anything while the tax rate is unset, and says why', async () => {
    const report = await build(null).report({ period: '2026-09' })

    expect(report.products.every(product => product.recommendedPriceCents === null)).toBe(true)
    expect(report.meta.notes.join(' ')).toContain('alíquota')
  })

  it('returns one product from the same inputs', async () => {
    const { product } = await build(707).product('COCA', { period: '2026-09' })

    expect(product.sku).toBe('COCA')
    expect(product.recommendedPriceCents).toBeGreaterThan(590)
  })

  it('reports the estimated impact with its label, never as profit', async () => {
    const report = await build(707).report({ period: '2026-09' })

    expect(report.summary.impactLabel).toBe('Impacto potencial estimado')
    expect(report.summary.potentialImpactCentsPerMonth).toBeGreaterThan(0)
  })
})

describe('PricingService — a product registered from an invoice', () => {
  const extra = [
    { id: 3, sku: 'NOVO', name: 'Novo sabor', category: 'meal', origin: { type: 'invoice', on: '2026-09-12' } },
    { id: 4, sku: 'ANTIGO', name: 'Registrado antes da janela', category: 'meal', origin: { type: 'invoice', on: '2026-05-01' } },
    { id: 5, sku: 'MANUAL', name: 'Manual', category: 'meal', origin: { type: 'manual', on: null } },
  ]

  it('is marked as a new product only when the invoice registration falls inside the analysed window, and says it has no sales history', async () => {
    const report = await build(707, extra).report({ period: '2026-09' })
    const by = (sku: string) => report.products.find(product => product.sku === sku)!

    expect(by('NOVO').newProduct).toEqual({ registeredOn: '2026-09-12', noSalesHistory: true })
    expect(by('ANTIGO').newProduct).toBeNull()
    expect(by('MANUAL').newProduct).toBeNull()
    expect(by('COCA').newProduct).toBeNull()
  })

  it('a product with no price and no sales gets a suggestion from the same engine, built on the invoice cost the request gives', async () => {
    const { suggestion, meta } = await build(707, extra).newProduct('NOVO', { period: '2026-09', costCents: 850, costOrigin: 'Nota fiscal 13021', costNotReceived: true })

    expect(meta.parameterVersion).toBe(7)
    expect(suggestion.label).toBe('Produto novo — sem histórico de vendas')
    expect(suggestion.status).toBe('suggested')
    expect(suggestion.confidence).toBe('low')
    expect(suggestion.suggestedPriceCents).toBeGreaterThan(850)
    expect(suggestion.dataUsed.find(d => d.code === 'cost')).toMatchObject({ value: 'R$ 8,50', origin: 'Nota fiscal 13021' })
    expect(suggestion.reasons.join(' ')).toContain('ainda não recebida')
    // Its loss comes from the category (the product has no history of its own).
    expect(suggestion.structure?.lossLevel).not.toBe('product')
  })

  it('refuses to suggest without a cost, and reports the unknown product', async () => {
    const none = await build(707, extra).newProduct('NOVO', { period: '2026-09' })
    expect(none.suggestion.status).toBe('insufficient_data')
    expect(none.suggestion.suggestedPriceCents).toBeNull()

    await expect(build(707, extra).newProduct('NADA', { period: '2026-09', costCents: 100 })).rejects.toThrow('not found')
  })
})

describe('PricingService — the origin of the cost comes from the registry', () => {
  it('reports the origin of the cost in force on each product, and none where the registry has no cost', async () => {
    const report = await build(707).report({ period: '2026-09' })
    const coca = report.products.find(product => product.sku === 'COCA')!
    const marmita = report.products.find(product => product.sku === 'MARM')!

    expect(coca.costOrigin).toEqual({ source: 'invoice', effectiveFrom: '2026-08-15', invoiceNumber: '13021' })
    expect(marmita.costOrigin).toBeNull()
  })
})

describe('PricingService — a period is history', () => {
  const cost = (asOf: string, effective: string, cents: number, source = 'invoice') => ({ as_of: asOf, resolved: [{ sku: 'COCA', product_id: 1, cost_cents: cents, effective_from: effective, source, invoice_number: null }], unresolved: [], complete: true })
  // September values at 309 (from August); anything later than 30/09 sees the October invoice at 350.
  const history = (asOf: string) => (asOf > '2026-09-30' ? cost(asOf, '2026-10-10', 350) : cost(asOf, '2026-08-15', 309, 'catalogue_sync'))

  it('values the period at the cost in force at its end and flags the newer cost apart, never as the period cost', async () => {
    const coca = (await build(707, [], history).report({ period: '2026-09' })).products.find(p => p.sku === 'COCA')!

    expect(coca.structure?.productCostCents).toBe(309)
    expect(coca.costOrigin).toMatchObject({ source: 'catalogue_sync', effectiveFrom: '2026-08-15' })
    expect(coca.newerCost).toEqual({ costCents: 350, effectiveFrom: '2026-10-10', source: 'invoice', basis: 'received_purchase' })
  })

  it('no newer cost when the registry has nothing after the period or the same value', async () => {
    const same = (await build(707).report({ period: '2026-09' })).products.find(p => p.sku === 'COCA')!
    expect(same.newerCost).toBeNull()
  })
})

describe('PricingService — coverage and pending reasons', () => {
  it('counts the analysable products against the total and groups the others by reason, never as margin zero', async () => {
    const { summary } = await build(707).report({ period: '2026-09' })

    expect(summary.coverage.total).toBe(2)
    expect(summary.coverage.analysable + summary.coverage.withoutEnoughData).toBe(2)
    expect(summary.coverage.withoutEnoughData).toBe(summary.insufficientData)
    expect(summary.pending.every(group => group.skus.length > 0)).toBe(true)
    // MARM has no cost in the fixture: it is pending for that reason.
    expect(summary.pending.find(group => group.code === 'no_cost')?.skus).toContain('MARM')
  })
})

describe('PricingService — draft suggestion for a product that is not registered', () => {
  it('prices from the category and the unit cost with the same structure as the report: a number, the structure, the target, the data used', async () => {
    const { suggestion, meta } = await build(707).draftSuggestion({ category: 'beverage', unitCostCents: 500 })

    expect(meta.parameterVersion).toBe(7)
    expect(suggestion.status).toBe('suggested')
    expect(suggestion.initial).toBe(true)
    expect(suggestion.label).toBe('Produto novo — sem histórico de vendas')
    expect(suggestion.unitCostCents).toBe(500)
    expect(suggestion.suggestedPriceCents).toBeGreaterThan(500)
    expect(suggestion.suggestedMargin).toBeGreaterThanOrEqual(suggestion.targetMargin - 0.005)
    expect(suggestion.structure?.taxRate).toBeCloseTo(0.0707, 6)
    // The loss comes from the category (there is no product history); and no volume or impact is invented.
    expect(suggestion.structure?.lossLevel).not.toBe('product')
    expect(JSON.stringify(suggestion)).not.toMatch(/impact|monthlyUnits/i)
  })

  it('a higher cost gives a higher suggested price, so changing the cost changes the suggestion', async () => {
    const service = build(707)
    const low = await service.draftSuggestion({ category: 'beverage', unitCostCents: 500 })
    const high = await service.draftSuggestion({ category: 'beverage', unitCostCents: 800 })

    expect(high.suggestion.suggestedPriceCents as number).toBeGreaterThan(low.suggestion.suggestedPriceCents as number)
  })

  it('names the category from the registry (a category created later is not "Outros")', async () => {
    const { suggestion } = await build(707).draftSuggestion({ category: 'congelados', unitCostCents: 500 })

    expect(suggestion.dataUsed.find(d => d.code === 'category')?.value).toBe('Congelados')
  })

  it('a typed price returns the margin at it from the same structure', async () => {
    const { suggestion } = await build(707).draftSuggestion({ category: 'beverage', unitCostCents: 500, typedPriceCents: 1000 })

    expect(suggestion.typedPrice).toMatchObject({ priceCents: 1000 })
    expect((suggestion.typedPrice as { margin: number }).margin).toBeGreaterThan(0)
    expect((suggestion.typedPrice as { margin: number }).margin).toBeLessThan(1)
    expect((await build(707).draftSuggestion({ category: 'beverage', unitCostCents: 500 })).suggestion.typedPrice).toBeNull()
  })

  it('lists what is missing instead of a price: no cost, no tax', async () => {
    const noCost = await build(707).draftSuggestion({ category: 'beverage' })
    const noTax = await build(null).draftSuggestion({ category: 'beverage', unitCostCents: 500 })

    expect(noCost.suggestion.status).toBe('insufficient_data')
    expect(noCost.suggestion.suggestedPriceCents).toBeNull()
    expect(noCost.suggestion.insufficientReasons).toEqual(['Sem custo: informe o custo da nota'])
    expect(noTax.suggestion.suggestedPriceCents).toBeNull()
    expect(noTax.suggestion.insufficientReasons).toEqual(['Alíquota de imposto não configurada'])
    expect(noTax.suggestion.typedPrice).toBeNull()
  })

  it('a zero or negative cost is a missing cost, never a zero price', async () => {
    for (const unitCostCents of [0, -5, Number.NaN]) {
      const { suggestion } = await build(707).draftSuggestion({ category: 'beverage', unitCostCents })
      expect(suggestion.suggestedPriceCents).toBeNull()
    }
  })

  it('does not load the catalogue costs: a draft has no products', async () => {
    const service = build(707)
    const report = await service.report({ period: '2026-09', skus: [] })

    expect(report.products).toEqual([])
  })
})

describe('PricingService — the operating costs are classified, not summed', () => {
  it('only the percentage-of-sales expenses enter the price; deslocamento and fixed costs are reported apart', async () => {
    const report = await build(707).report({ period: '2026-09' })
    const coca = report.products.find(p => p.sku === 'COCA')!
    const operating = report.meta.operating!

    expect(coca.structure?.operatingShare).toBeCloseTo(0.02, 10)
    expect(operating.classes.percent_of_sales.accounts.map(a => a.code)).toEqual(['4.2.01'])
    expect(operating.classes.per_visit.costCents).toBe(30_000) // 3 months x 10.000
    expect(operating.classes.fixed.costCents).toBe(120_000)
    expect(operating.percentOfSalesShare).toBeCloseTo(0.02, 10)
    // What the old method would have put in the price: 2% + 1% + 4% = 7%.
    expect(operating.legacy.share).toBeCloseTo(0.07, 10)
    expect(report.meta.validated).toBe(true)
    expect(coca.validated).toBe(true)
  })

  it('shows the three numbers: contribution margin, contribution per unit and the result after allocation, with its criterion', async () => {
    const coca = (await build(707).report({ period: '2026-09' })).products.find(p => p.sku === 'COCA')!
    const price = 590
    const unit = price * (1 - 0.0707 - (coca.structure?.paymentRate ?? 0) - 0.02) - ((309 / 0.98) + (coca.structure?.paymentFixedCents ?? 0))

    expect(coca.unitContributionCents).toBeCloseTo(unit, 6)
    expect(coca.currentMargin).toBeCloseTo(unit / price, 8)
    // Allocation: deslocamento 1% + fixed 4% of store revenue are spread over the price.
    expect(coca.estimatedResultAfterAllocation?.margin).toBeCloseTo(unit / price - 0.05, 8)
    expect(coca.estimatedResultAfterAllocation?.centsPerUnit).toBeCloseTo(unit - price * 0.05, 6)
    expect(coca.estimatedResultAfterAllocation?.criterion).toContain('não o lucro líquido')
    expect(coca.estimatedResultAfterAllocation?.criterion).toContain('rede')
  })

  it('an unclassified expense is listed with value, period and scope, and nothing is shown as validated', async () => {
    const report = await build(707, [], undefined, { extraAccounts: [acct('4.2.07', 'Marketing', 30_000)] }).report({ period: '2026-09' })
    const coca = report.products.find(p => p.sku === 'COCA')!

    expect(report.meta.validated).toBe(false)
    expect(report.meta.operating?.unclassified).toEqual([{ code: '4.2.07', label: 'Marketing', amountCents: 90_000 }])
    expect(report.meta.notes.join(' ')).toContain('Precificação não validada')
    expect(coca.validated).toBe(false)
    expect(coca.validationNotes.join(' ')).toMatch(/Precificação não validada: faltam classificar R\$ 900,00 .*rede.*2026-07, 2026-08, 2026-09.*4\.2\.07 Marketing/)
    // The number is still there; it is just not presented as validated.
    expect(coca.recommendedPriceCents).not.toBeNull()
  })

  it('once the owner classifies the expense, it is validated again and the class decides where it counts', async () => {
    const asFixed = await build(707, [], undefined, { extraAccounts: [acct('4.2.07', 'Marketing', 30_000)], patch: { operating: { accountBehavior: { ...DEFAULT_PRICING_PARAMETERS.operating.accountBehavior, '4.2.07': 'fixed' } } } }).report({ period: '2026-09' })
    const asPercent = await build(707, [], undefined, { extraAccounts: [acct('4.2.07', 'Marketing', 30_000)], patch: { operating: { accountBehavior: { ...DEFAULT_PRICING_PARAMETERS.operating.accountBehavior, '4.2.07': 'percent_of_sales' } } } }).report({ period: '2026-09' })

    expect(asFixed.meta.validated).toBe(true)
    expect(asFixed.products.find(p => p.sku === 'COCA')?.structure?.operatingShare).toBeCloseTo(0.02, 10) // fixed: outside the price
    expect(asPercent.products.find(p => p.sku === 'COCA')?.structure?.operatingShare).toBeCloseTo(0.05, 10) // 2% + 3%: inside it
  })

  it('a per-transaction expense is distributed per sold unit (ticket, not line) and added to the numerator without the loss', async () => {
    const patch = { operating: { accountBehavior: { ...DEFAULT_PRICING_PARAMETERS.operating.accountBehavior, '4.2.08': 'per_transaction' } } }
    const report = await build(707, [], undefined, { extraAccounts: [acct('4.2.08', 'Custo por transação', 4_000)], patch }).report({ period: '2026-09' })
    const coca = report.products.find(p => p.sku === 'COCA')!

    // 3 months x 4.000 = 12.000 over the 300 units sold in the window (400 lines, each counted as a ticket: no coupon in the fixture).
    const perUnit = 12_000 / 300
    expect(coca.structure?.perTransactionCents).toBeCloseTo(perUnit, 8)
    expect(report.meta.operating?.perTransaction?.perUnitCents).toBeCloseTo(perUnit, 8)
    expect(report.meta.operating?.perTransaction?.assumption).toContain('Tickets identificados pelo código da compra')
    expect(coca.validationNotes.join(' ')).toContain('Tickets identificados pelo código da compra')
    // Added to the numerator as money, never multiplied by the loss and never a share of the price.
    expect(coca.structure?.operatingShare).toBeCloseTo(0.02, 10)
    expect(coca.structure?.lossAdjustedCostCents).toBeCloseTo(309 / 0.98, 8)
  })
})

describe('PricingService — three cost bases kept apart', () => {
  const version = (cents: number, effective: string, source: string, invoice: string | null = null) => ({ sku: 'COCA', product_id: 1, cost_cents: cents, effective_from: effective, source, invoice_number: invoice })
  // Period cost 309 (a purchase of 15/08); a received purchase of 02/10 at 350; a manual correction of 04/10 at 400 is the cost in force today.
  const costs = (asOf: string, sources?: string[]) => {
    const all = [version(309, '2026-08-15', 'invoice', '13021'), version(350, '2026-10-02', 'invoice', '13990'), version(400, '2026-10-04', 'manual')]
    const pool = sources ? all.filter(v => sources.includes(v.source)) : all
    const inForce = pool.filter(v => v.effective_from <= asOf).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0]

    return { as_of: asOf, resolved: inForce ? [inForce] : [], unresolved: inForce ? [] : [{ sku: 'COCA', reason: 'no_cost_for_date' }], complete: !!inForce }
  }

  it('keeps the historical cost, the last received purchase and the manual cost in force apart, labelled', async () => {
    const coca = (await build(707, [], costs).report({ period: '2026-09' })).products.find(p => p.sku === 'COCA')!

    expect(coca.costBases.historical).toMatchObject({ costCents: 309, source: 'invoice', basis: 'received_purchase' })
    expect(coca.costBases.lastPurchase).toEqual({ costCents: 350, effectiveFrom: '2026-10-02', invoiceNumber: '13990' })
    expect(coca.costBases.registry).toEqual({ costCents: 400, effectiveFrom: '2026-10-04', source: 'manual' })
    // The cost in force today is a manual one: it is NEVER labelled a confirmed purchase.
    expect(coca.newerCost).toMatchObject({ costCents: 400, source: 'manual', basis: 'registry_or_manual' })
    // The diagnosis stays on the period's cost.
    expect(coca.structure?.productCostCents).toBe(309)
  })

  it('redoes the diagnosis at the last received purchase cost for the current suggestion, without touching the period', async () => {
    const coca = (await build(707, [], costs).report({ period: '2026-09' })).products.find(p => p.sku === 'COCA')!

    expect(coca.atLastPurchaseCost).toMatchObject({ basis: 'received_purchase', costCents: 350, effectiveFrom: '2026-10-02' })
    expect(coca.atLastPurchaseCost?.marginAtCurrentPrice).toBeLessThan(coca.currentMargin as number)
    expect(coca.atLastPurchaseCost?.targetPriceCents as number).toBeGreaterThan(coca.targetPriceCents as number)
  })

  it('asks the registry only for received purchases when it looks for the last purchase', async () => {
    const asked: (string[] | undefined)[] = []
    await build(707, [], (asOf, sources) => {
      asked.push(sources)
      return costs(asOf, sources)
    }).report({ period: '2026-09' })

    expect(asked).toContainEqual(['invoice'])
    expect(asked).toContainEqual(undefined)
  })

  it('with only a manual cost there is no "last purchase": it says so instead of calling the manual cost a purchase', async () => {
    const onlyManual = (asOf: string, sources?: string[]) => {
      const all = [version(309, '2026-08-15', 'manual')]
      const pool = sources ? all.filter(v => sources.includes(v.source)) : all
      return { as_of: asOf, resolved: pool.filter(v => v.effective_from <= asOf), unresolved: [], complete: true }
    }
    const coca = (await build(707, [], onlyManual).report({ period: '2026-09' })).products.find(p => p.sku === 'COCA')!

    expect(coca.costBases.lastPurchase).toBeNull()
    expect(coca.costBases.registry).toMatchObject({ costCents: 309, source: 'manual' })
    expect(coca.costBases.historical?.basis).toBe('registry_or_manual')
    expect(coca.atLastPurchaseCost).toBeNull()
  })
})

describe('PricingService — average travel cost per restocking', () => {
  // The fixture DRE has Deslocamento at 10.000 cents a month (per_visit) and store 1 with 4 restocking visits a month.
  it('divides each month spend by the restocking visits of the same month and shows the figures, the unit and the limits', async () => {
    const travel = (await build(707).report({ period: '2026-09' })).meta.operating?.travel

    expect(travel?.perVisitCents).toBeCloseTo(30_000 / 12, 8) // 3 months x 10.000 over 3 x 4 visits
    expect(travel?.months.map(month => [month.period, month.costCents, month.visits, month.perVisitCents])).toEqual([['2026-07', 10_000, 4, 2500], ['2026-08', 10_000, 4, 2500], ['2026-09', 10_000, 4, 2500]])
    expect(travel?.unit).toContain('uma loja atendida')
    expect(travel?.limitations.join(' ')).toContain('não é exclusiva do minimercado')
    expect(travel?.limitations.join(' ')).toContain('não o custo real de uma rota')
  })

  it('apportions to a store only from its real visits, as an estimate that adds up to the pooled spend', async () => {
    const travel = (await build(707).report({ period: '2026-09' })).meta.operating?.travel

    expect(travel?.stores).toEqual([{ storeId: 1, visits: 12, estimatedCents: 30_000 }])
    expect(travel?.limitations.join(' ')).toContain('rateio estimado')
  })

  it('a month with no visit record is excluded with its reason, not divided and not treated as zero cost', async () => {
    const visits = [{ store_id: 1, period: '2026-08', restocking_visits: 4 }, { store_id: 1, period: '2026-09', restocking_visits: 4 }]
    const travel = (await build(707, [], undefined, { visits }).report({ period: '2026-09' })).meta.operating?.travel

    expect(travel?.excludedMonths).toEqual([{ period: '2026-07', reason: 'sem registro de abastecimentos no mês (desconhecido, não zero)' }])
    // The July spend is NOT in the numerator while its visits are missing from the denominator.
    expect(travel?.usedCostCents).toBe(20_000)
    expect(travel?.perVisitCents).toBeCloseTo(20_000 / 8, 8)
  })

  it('with no visits at all there is no average and no apportionment', async () => {
    const travel = (await build(707, [], undefined, { visits: [] }).report({ period: '2026-09' })).meta.operating?.travel

    expect(travel?.perVisitCents).toBeNull()
    expect(travel?.stores).toEqual([])
    expect(travel?.excludedMonths).toHaveLength(3)
  })

  it('without the supply service the report still works and the average is simply unavailable', async () => {
    const report = await build(707, [], undefined, { visits: null }).report({ period: '2026-09' })

    expect(report.meta.operating?.travel).toBeNull()
    expect(report.products.find(p => p.sku === 'COCA')?.status).not.toBe('insufficient_data')
  })

  it('a single store reads only its own visits', async () => {
    const visits = [{ store_id: 1, period: '2026-09', restocking_visits: 5 }, { store_id: 2, period: '2026-09', restocking_visits: 50 }]
    const travel = (await build(707, [], undefined, { visits }).report({ period: '2026-09', storeId: 1 })).meta.operating?.travel

    expect(travel?.scope).toBe('loja 1')
    expect(travel?.months.find(month => month.period === '2026-09')?.visits).toBe(5)
    expect(travel?.stores).toEqual([]) // no per-store split inside a store scope
  })

  it('travel stays out of the price and appears once, in the result after allocation', async () => {
    const coca = (await build(707).report({ period: '2026-09' })).products.find(p => p.sku === 'COCA')!

    expect(coca.structure?.operatingShare).toBeCloseTo(0.02, 10) // repasse only
    expect(coca.estimatedResultAfterAllocation?.margin).toBeCloseTo((coca.currentMargin as number) - 0.05, 8) // deslocamento 1% + fixed 4%
  })
})

describe('PricingService — whose payment mix weighs the fees (product, category, network, or no price)', () => {
  const lines = (sku: string, count: number) => [{ sku, method: 'Pix', acquirer: 'PagBank', card_brand: null, receipt_lines: count, units: count, amount_paid_cents: count * 500 }]
  const rateOf = (report: Awaited<ReturnType<ReturnType<typeof build>['report']>>, sku: string) => report.products.find(p => p.sku === sku)!.structure

  it('a product with enough receipt lines of its own uses ITS mix', async () => {
    const report = await build(707, [], undefined, { mixBySku: lines('COCA', 40) }).report({ period: '2026-09' })

    expect(rateOf(report, 'COCA')).toMatchObject({ paymentLevel: 'product', paymentMixLines: 40 })
    expect(rateOf(report, 'COCA')?.voucherShare).toBe(0) // all Pix: the product has no voucher sales
  })

  it('a product with too few lines falls back to its category, summed over the category products', async () => {
    const extra = [{ id: 3, sku: 'SPRITE', name: 'Sprite', category: 'beverage' }]
    const report = await build(707, extra, undefined, { mixBySku: [...lines('COCA', 20), ...lines('SPRITE', 20)] }).report({ period: '2026-09' })

    // COCA (20 lines) and SPRITE (20 lines) are each below the minimum of 30, but together the beverage category has 40.
    expect(rateOf(report, 'COCA')).toMatchObject({ paymentLevel: 'category', paymentMixLines: 40 })
  })

  it('with nothing reliable at product or category, the network mix is used and is named as such', async () => {
    const report = await build(707, [], undefined, { mixBySku: lines('COCA', 5) }).report({ period: '2026-09' })

    expect(rateOf(report, 'COCA')).toMatchObject({ paymentLevel: 'network', paymentMixLines: 400 })
  })

  it('without a reliable mix at ANY level there is no recommendation, and it says which data is missing', async () => {
    const service = build(707, [], undefined, { mixBySku: lines('COCA', 5), patch: { payment: { minMixReceiptLines: 1000 } } })
    const coca = (await service.report({ period: '2026-09' })).products.find(p => p.sku === 'COCA')!

    expect(coca.status).toBe('insufficient_data')
    expect(coca.recommendedPriceCents).toBeNull()
    expect(coca.insufficientReasons.join(' ')).toContain('Sem mix de pagamento confiável')
  })

  it('an older sales service without the per-product route still prices, from the network mix', async () => {
    const service = build(707)
    ;(service as unknown as { sales: Record<string, unknown> }).sales.paymentMixBySku = async () => {
      throw new Error('404')
    }
    const coca = (await service.report({ period: '2026-09' })).products.find(p => p.sku === 'COCA')!

    expect(coca.structure?.paymentLevel).toBe('network')
  })

  it('the fixed fee per unit is the NETWORK\'s whatever the level (a per-product split has no tickets)', async () => {
    const withProductMix = await build(707, [], undefined, { mixBySku: lines('COCA', 40) }).report({ period: '2026-09' })
    const networkOnly = await build(707, [], undefined, { mixBySku: [] }).report({ period: '2026-09' })

    expect(rateOf(withProductMix, 'COCA')?.paymentFixedCents).toBeCloseTo(rateOf(networkOnly, 'COCA')?.paymentFixedCents as number, 10)
  })

  it('a draft (no history) uses the category mix when reliable, else the network\'s, else says what is missing', async () => {
    const service = build(707, [], undefined, { mixBySku: lines('COCA', 40) })
    const fromCategory = await service.draftSuggestion({ category: 'beverage', unitCostCents: 300 })
    const fromNetwork = await service.draftSuggestion({ category: 'congelados', unitCostCents: 300 })

    expect(fromCategory.suggestion.status).toBe('suggested')
    expect(fromCategory.suggestion.dataUsed.find(row => row.code === 'payment')?.origin).toBeDefined()
    expect(fromNetwork.suggestion.status).toBe('suggested')

    const none = build(707, [], undefined, { mixBySku: [], patch: { payment: { minMixReceiptLines: 100_000 } } })
    const missing = await none.draftSuggestion({ category: 'beverage', unitCostCents: 300 })
    expect(missing.suggestion.status).toBe('insufficient_data')
    expect(missing.suggestion.insufficientReasons.join(' ')).toContain('Sem mix de pagamento confiável')
  })
})

describe('PricingService — the loss rate and its denominator', () => {
  it('shows the units behind the rate: lost ÷ supplied, and what is left of the supplied after sold and lost', async () => {
    const coca = (await build(707).report({ period: '2026-09' })).products.find(p => p.sku === 'COCA')!
    const basis = coca.structure?.lossBasis

    // The fake supply restocks 100 and removes 2 as loss per store-month; sales say 100 sold. 2 ÷ 100 = 2%.
    expect(basis).toMatchObject({ lostUnits: 6, suppliedUnits: 300, soldUnits: 300 })
    expect(coca.structure?.lossRate).toBeCloseTo(6 / 300, 10)
    expect(basis?.unaccountedUnits).toBe(300 - 6 - 300)
    expect(basis?.definition).toContain('unidades removidas como perda ÷ unidades abastecidas')
  })

  it('the cost per sold unit is cost ÷ (1 − loss), with that loss', async () => {
    const coca = (await build(707).report({ period: '2026-09' })).products.find(p => p.sku === 'COCA')!

    expect(coca.structure?.lossAdjustedCostCents).toBeCloseTo(309 / (1 - 0.02), 6)
  })
})

describe('PricingService — the fixed payment fee reaches the price per unit', () => {
  it('reports how the fee was built: tickets identified by the purchase code, and the total is an estimate', async () => {
    const payment = (await build(707).report({ period: '2026-09' })).meta.payment

    expect(payment?.fixed).toMatchObject({ basis: 'identified', tickets: 400, units: 300, lines: 400, linesWithoutTicketId: 0 })
    expect(payment?.fixed?.note).toContain('Total estimado')
    expect(payment?.fixed?.note).toContain('não é o valor cobrado pelas adquirentes')
  })

  it('carries the basis into each product structure so the screen can say it', async () => {
    const coca = (await build(707).report({ period: '2026-09' })).products.find(p => p.sku === 'COCA')!

    expect(coca.structure?.paymentFixed?.basis).toBe('identified')
    expect(coca.structure?.paymentFixed?.note).toContain('Tickets identificados pelo código da compra')
  })
})

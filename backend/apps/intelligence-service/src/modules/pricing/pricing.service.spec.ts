import { NullPurchaseSource } from '../analysis/purchase-source'
import type { PnlDto } from '../sources/accounting.client'
import { DEFAULT_PRICING_PARAMETERS, mergePricingParameters } from './pricing.parameters'
import { PricingService } from './pricing.service'

const MONTHS = ['2026-07', '2026-08', '2026-09']

const pnl = (period: string): PnlDto => ({
  period,
  store_id: null,
  sections: [
    { section: 'gross_revenue', amount_cents: 1_000_000, accounts: [{ code: '3.1.01', label: 'Vendas lojas', section: '', amount_cents: 1_000_000, children: [] }] },
    { section: 'fixed_expenses', amount_cents: 40_000, accounts: [{ code: '4.3.01', label: 'Mensalidade touchpay', section: '', amount_cents: 40_000, children: [] }] },
  ],
})

function build(taxRateBps: number | null, extraProducts: Record<string, unknown>[] = []) {
  const params = mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { taxRateBps } as never)
  const supply = {
    period: async () => ({ store_id: 1, period: 'x', restocks: [{ sku: 'COCA', quantity_restocked: 100 }], removals: [{ sku: 'COCA', reason: 'expired', counts_as_loss: true, quantity_removed: 2 }], adjustments: [] }),
  }
  const sales = {
    period: async () => [{ sku: 'COCA', quantity_sold: 100, revenue_cents: 59_000 }],
    paymentMix: async () => ({
      from: MONTHS[0],
      to: MONTHS[2],
      store_id: null,
      rows: [
        { method: 'Voucher', acquirer: 'x', card_brand: 'Alelo', receipt_lines: 100, amount_paid_cents: 2200 },
        { method: 'Pix', acquirer: 'PagBank', card_brand: null, receipt_lines: 100, amount_paid_cents: 4000 },
        { method: 'Débito', acquirer: 'PagBank', card_brand: null, receipt_lines: 100, amount_paid_cents: 2000 },
        { method: 'Crédito', acquirer: 'PagBank', card_brand: null, receipt_lines: 100, amount_paid_cents: 1800 },
      ],
      total_amount_paid_cents: 10_000,
      periods_without_transactions: [],
    }),
  }
  const products = {
    products: async () => [
      { id: 1, sku: 'COCA', name: 'Coca-Cola Lata 350ml', category: 'beverage', subcategory: 'Refrigerantes', ean: '789490001537', supplier_id: 9 },
      { id: 2, sku: 'MARM', name: 'Marmita', category: 'meal' },
      ...extraProducts,
    ],
    costsAsOf: async (_skus: string[], asOf: string) => ({
      as_of: asOf,
      resolved: [{ sku: 'COCA', product_id: 1, cost_cents: 309, effective_from: '2026-08-15', source: 'invoice', invoice_number: '13021' }],
      unresolved: [{ sku: 'MARM', reason: 'no_cost_before_date' }],
      complete: false,
    }),
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
  const accounting = { pnl: async (period: string) => pnl(period) }
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
    expect(coca.structure).toMatchObject({ taxRate: 0.0707, lossRate: 0.02, lossLevel: 'product', operatingShare: 0.04 })
    expect(coca.structure?.paymentRate).toBeCloseTo(0.017486, 6)
    expect(coca.structure?.voucherShare).toBeCloseTo(0.22, 6)
    expect(coca.monthlyUnits).toBe(100)
    expect(coca.monthlyRevenueCents).toBe(59_000)
    expect(coca.status).toBe('adjust')
    expect(coca.recommendedPriceCents).toBeGreaterThan(590)
  })

  it('carries the identity the table needs, and none for a product without a supplier', async () => {
    const report = await build(707).report({ period: '2026-09' })
    const coca = report.products.find(product => product.sku === 'COCA')!
    const marmita = report.products.find(product => product.sku === 'MARM')!

    expect(coca).toMatchObject({ ean: '789490001537', supplierId: 9, supplierName: 'Coca-Cola FEMSA', category: 'beverage', categoryLabel: 'Bebidas', subcategory: 'Refrigerantes' })
    expect(marmita).toMatchObject({ ean: null, supplierId: null, supplierName: null, categoryLabel: 'Refeições' })
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

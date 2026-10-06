import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import { productInsights, supplierInsights } from './analysis.insights'
import { compareMovements, movementOf, type Cell, type MonthFacts } from './analysis.metrics'
import type { Movement, StoreRow } from './analysis.types'

const P = DEFAULT_PARAMETERS.analysis

function monthOf(stores: Record<number, Record<string, Cell>>): MonthFacts {
  return {
    month: '2026-10',
    cells: new Map(Object.entries(stores).map(([id, skus]) => [Number(id), new Map(Object.entries(skus))])),
    storesMissingSupply: [],
    storesMissingSales: [],
    storeCount: Object.keys(stores).length,
  }
}
const c = (restocked: number, sold: number, lost: number, revenueCents = 0): Cell => ({ restocked, sold, lost, revenueCents })

function movements(current: Record<number, Record<string, Cell>>, previous: Record<number, Record<string, Cell>>, purchases?: [number, number]) {
  const skus = new Set(['A', 'B'])
  const cost = () => 100
  const now = movementOf(monthOf(current), skus, cost, purchases ? new Map([['A', { units: purchases[0], cents: purchases[0] * 100 }]]) : null)
  const before = movementOf(monthOf(previous), skus, cost, purchases ? new Map([['A', { units: purchases[1], cents: purchases[1] * 100 }]]) : null)

  return { now, comparison: compareMovements(now, [before], 'prev_month') as ReturnType<typeof compareMovements> }
}

describe('supplierInsights', () => {
  it('never produces a purchase-dependent insight while purchases are unavailable', () => {
    const { now, comparison } = movements({ 1: { A: c(270, 245, 12, 245000) } }, { 1: { A: c(250, 218, 8, 218000) } })
    const kinds = supplierInsights({ movement: now, comparison, products: [], networkLossShare: 0.05, storesRestocked: 1, compareTo: 'prev_month', p: P }).map(i => i.kind)

    expect(kinds).not.toContain('purchases_outpace_sales')
    expect(kinds).not.toContain('purchases_change')
    expect(kinds).not.toContain('purchased_not_restocked')
    expect(kinds).toContain('sales_change')
    expect(kinds).toContain('loss_up')
  })

  it('says purchases outpaced sales, with the numbers that show it', () => {
    const { now, comparison } = movements({ 1: { A: c(270, 106, 1) } }, { 1: { A: c(250, 100, 1) } }, [300, 250])
    const insights = supplierInsights({ movement: now, comparison, products: [], networkLossShare: null, storesRestocked: 1, compareTo: 'prev_month', p: P })
    const outpace = insights.find(i => i.kind === 'purchases_outpace_sales')

    expect(outpace?.text).toMatch(/compras aumentaram 20%, mas as vendas aumentaram apenas 6%, em relação ao mês anterior\./)
    expect(outpace?.evidence.figures.purchasedChange).toBeCloseTo(0.2)
    expect(outpace?.evidence.figures.soldChange).toBeCloseTo(0.06)
  })

  it('reports the share bought but not yet restocked', () => {
    const { now, comparison } = movements({ 1: { A: c(204, 100, 1) } }, { 1: { A: c(204, 100, 1) } }, [300, 300])
    const found = supplierInsights({ movement: now, comparison, products: [], networkLossShare: null, storesRestocked: 1, compareTo: 'prev_month', p: P }).find(i => i.kind === 'purchased_not_restocked')

    expect(found?.text).toBe('32% das unidades compradas ainda não foram abastecidas.')
    expect(found?.evidence.figures).toMatchObject({ purchased: 300, restocked: 204 })
  })

  it('labels every insight and gives it evidence', () => {
    const { now, comparison } = movements({ 1: { A: c(270, 245, 12, 245000) } }, { 1: { A: c(250, 218, 8, 218000) } })
    const insights = supplierInsights({ movement: now, comparison, products: [], networkLossShare: 0.05, storesRestocked: 1, compareTo: 'prev_month', p: P })

    expect(insights.length).toBeGreaterThan(0)
    for (const insight of insights) {
      expect(['FATO', 'MÉTRICA DERIVADA', 'ESTIMATIVA']).toContain(insight.label)
      expect(Object.keys(insight.evidence.figures).length).toBeGreaterThan(0)
    }
  })
})

describe('productInsights', () => {
  const stores: StoreRow[] = [
    { storeId: 1, storeName: 'Ascenty ADM', restocked: 30, sold: 24, lost: 2, sellThrough: 0.8, situation: 'good' },
    { storeId: 2, storeName: 'Taipas', restocked: 30, sold: 5, lost: 8, sellThrough: 5 / 30, situation: 'critical' },
    { storeId: 3, storeName: 'Franco da Rocha', restocked: 30, sold: 0, lost: 6, sellThrough: 0, situation: 'critical' },
  ]
  const { now, comparison } = movements({ 1: { A: c(90, 29, 16) } }, { 1: { A: c(90, 20, 10) } })
  const insights = productInsights({ movement: now as Movement, comparison, stores, compareTo: 'prev_month', p: P, networkLossShare: 0.05 })

  it('states the funnel without inventing purchases', () => {
    const funnel = insights.find(i => i.kind === 'funnel')

    expect(funnel?.text).toContain('sem histórico de compras')
    expect(funnel?.evidence.figures).not.toHaveProperty('purchased')
  })

  it('names where it sells and where it does not, with the ratio behind it', () => {
    expect(insights.find(i => i.kind === 'stores_selling')?.text).toBe('Este produto vende em 2 das 3 lojas onde foi abastecido.')
    const taipas = insights.find(i => i.kind === 'store_below_network' && i.text.startsWith('Taipas'))
    expect(taipas?.text).toContain('recebeu 30 un., mas vendeu 5 un. e perdeu 8 un.')
    expect(taipas?.evidence.figures.sellThrough).toBeCloseTo(5 / 30)
  })

  it('flags a loss rate above the network as derived, not as fact', () => {
    const loss = insights.find(i => i.kind === 'loss_above_network')

    expect(loss?.label).toBe('MÉTRICA DERIVADA')
  })

  it('labels a redistribution hint as an ESTIMATIVA', () => {
    const hint = productInsights({ movement: now as Movement, comparison, stores: [stores[0], stores[1], stores[2]], compareTo: 'prev_month', p: P, networkLossShare: null }).find(i => i.kind === 'concentrated_demand')

    expect(hint?.label).toBe('ESTIMATIVA')
  })
})

describe('low-margin insight', () => {
  it('names the products below the attention margin, worst first, with the threshold as evidence', () => {
    const { now, comparison } = movements({ 1: { A: c(270, 245, 12, 245000) } }, { 1: { A: c(250, 218, 8, 218000) } })
    const line = (sku: string, name: string, margin: number) => ({ sku, name, supplierId: 1, movement: { ...now, marginShare: { available: true as const, value: margin } }, comparison })
    const lowMargin = [line('A', 'Água', 0.18), line('B', 'Refri', 0.05)]
    const found = supplierInsights({ movement: now, comparison, products: lowMargin, lowMargin, networkLossShare: null, storesRestocked: 1, compareTo: 'prev_month', p: P }).find(i => i.kind === 'low_margin_products')

    expect(found?.text).toBe('2 produtos têm margem bruta abaixo de 20%: Refri (5%), Água (18%).')
    expect(found?.evidence.figures.threshold).toBe(0.2)
  })
})

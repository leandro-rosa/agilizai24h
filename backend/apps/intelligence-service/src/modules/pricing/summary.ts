import type { PriceResult } from './price'

export interface PricingSummary {
  analysed: number
  /** Revenue-weighted average margin of products with a margin, a fraction. */
  averageMargin: number | null
  targetMargin: number
  withinTarget: number
  belowTarget: number
  opportunities: number
  insufficientData: number
  review: number
  /** Sum of the estimated monthly impacts of the recommendations. An estimate, never guaranteed profit. */
  potentialImpactCentsPerMonth: number
  impactLabel: 'Impacto potencial estimado'
  coverage: Coverage
  pending: PendingGroup[]
  /** Share of the analysed catalogue, as fractions. */
  shares: { withinTarget: number; belowTarget: number; opportunities: number; insufficientData: number }
}

/** Why products cannot be analysed, grouped. A product can have more than one reason, so the groups can overlap. */
export interface PendingGroup {
  code: 'no_cost' | 'stale_cost' | 'unreliable_cost' | 'no_price' | 'no_tax' | 'no_payment_or_loss' | 'other'
  label: string
  skus: string[]
}

export interface Coverage {
  /** Every product the report read. */
  total: number
  /** Products with enough data for a margin and a recommendation. The cards describe ONLY these. */
  analysable: number
  /** Products left out for lack of data: counted apart, never as margin zero. */
  withoutEnoughData: number
}

export interface CategorySummary {
  /** The Portuguese label, and the catalogue key it comes from (margin overrides and the screen's filter use the key). */
  category: string
  categoryKey: string
  averageMargin: number | null
  targetMargin: number
  /** Margin minus target, in fraction points. */
  difference: number | null
  revenueCents: number
  revenueShare: number
  products: number
}

const REASONS: { test: RegExp; code: PendingGroup['code']; label: string }[] = [
  { test: /^Sem custo cadastrado/, code: 'no_cost', label: 'Sem custo cadastrado' },
  { test: /^Custo desatualizado/, code: 'stale_cost', label: 'Custo desatualizado (sem compra no período)' },
  { test: /^Custo marcado como não confiável/, code: 'unreliable_cost', label: 'Custo marcado como não confiável' },
  { test: /^Sem preço atual/, code: 'no_price', label: 'Sem preço de venda cadastrado' },
  { test: /^Alíquota de imposto/, code: 'no_tax', label: 'Alíquota de imposto não configurada' },
  { test: /^Sem vendas para calcular|^Sem histórico de perda|^Rateio operacional/, code: 'no_payment_or_loss', label: 'Faltam vendas, perda ou rateio para a estrutura de custos' },
]

/** Groups the reasons of the products without enough data, most affected first. */
export function pendingGroups(results: PriceResult[]): PendingGroup[] {
  const groups = new Map<PendingGroup['code'], PendingGroup>()
  for (const result of results.filter(r => r.status === 'insufficient_data')) {
    const codes = new Set<PendingGroup['code']>()
    for (const reason of result.insufficientReasons) codes.add(REASONS.find(r => r.test.test(reason))?.code ?? 'other')
    for (const code of codes) {
      const label = REASONS.find(r => r.code === code)?.label ?? 'Outro motivo'
      groups.set(code, { code, label, skus: [...(groups.get(code)?.skus ?? []), result.sku] })
    }
  }

  return [...groups.values()].sort((a, b) => b.skus.length - a.skus.length)
}

/** Card figures for the top of the screen. `revenueBySku` is the revenue of the window, used to weight margins. */
export function summarise(results: PriceResult[], targetMargin: number, revenueBySku: Map<string, number>): PricingSummary {
  const rated = results.filter(result => result.currentMargin !== null)
  const weight = (result: PriceResult) => revenueBySku.get(result.sku) ?? 0
  const totalWeight = rated.reduce((sum, result) => sum + weight(result), 0)
  const average = totalWeight > 0 ? rated.reduce((sum, result) => sum + (result.currentMargin as number) * weight(result), 0) / totalWeight : null

  const count = (status: PriceResult['status']) => results.filter(result => result.status === status).length
  const belowTarget = results.filter(result => result.status === 'adjust').length
  const analysed = results.length
  const share = (n: number) => (analysed > 0 ? n / analysed : 0)
  const withinTarget = rated.filter(result => (result.currentMargin as number) >= result.targetMargin - 1e-9).length

  return {
    analysed,
    averageMargin: average,
    targetMargin,
    withinTarget,
    belowTarget,
    opportunities: count('opportunity'),
    insufficientData: count('insufficient_data'),
    review: count('review'),
    coverage: { total: results.length, analysable: results.length - count('insufficient_data'), withoutEnoughData: count('insufficient_data') },
    pending: pendingGroups(results),
    potentialImpactCentsPerMonth: results.reduce((sum, result) => sum + (result.impactCentsPerMonth ?? 0), 0),
    impactLabel: 'Impacto potencial estimado',
    shares: { withinTarget: share(withinTarget), belowTarget: share(belowTarget), opportunities: share(count('opportunity')), insufficientData: share(count('insufficient_data')) },
  }
}

export function byCategory(results: PriceResult[], revenueBySku: Map<string, number>): CategorySummary[] {
  const groups = new Map<string, PriceResult[]>()
  for (const result of results) groups.set(result.category ?? '', [...(groups.get(result.category ?? '') ?? []), result])

  const totalRevenue = [...revenueBySku.values()].reduce((sum, value) => sum + value, 0)

  return [...groups.entries()]
    .map(([categoryKey, items]) => {
      const rated = items.filter(item => item.currentMargin !== null)
      const revenue = items.reduce((sum, item) => sum + (revenueBySku.get(item.sku) ?? 0), 0)
      const ratedRevenue = rated.reduce((sum, item) => sum + (revenueBySku.get(item.sku) ?? 0), 0)
      const margin = ratedRevenue > 0 ? rated.reduce((sum, item) => sum + (item.currentMargin as number) * (revenueBySku.get(item.sku) ?? 0), 0) / ratedRevenue : null
      const target = items[0].targetMargin

      return { category: items[0].categoryLabel, categoryKey, averageMargin: margin, targetMargin: target, difference: margin === null ? null : margin - target, revenueCents: revenue, revenueShare: totalRevenue > 0 ? revenue / totalRevenue : 0, products: items.length }
    })
    .sort((a, b) => b.revenueCents - a.revenueCents)
}

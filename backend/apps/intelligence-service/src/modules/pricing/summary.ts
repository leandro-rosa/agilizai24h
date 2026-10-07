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
  /** Share of the analysed catalogue, as fractions. */
  shares: { withinTarget: number; belowTarget: number; opportunities: number; insufficientData: number }
}

export interface CategorySummary {
  category: string
  averageMargin: number | null
  targetMargin: number
  /** Margin minus target, in fraction points. */
  difference: number | null
  revenueCents: number
  revenueShare: number
  products: number
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
    potentialImpactCentsPerMonth: results.reduce((sum, result) => sum + (result.impactCentsPerMonth ?? 0), 0),
    impactLabel: 'Impacto potencial estimado',
    shares: { withinTarget: share(withinTarget), belowTarget: share(belowTarget), opportunities: share(count('opportunity')), insufficientData: share(count('insufficient_data')) },
  }
}

export function byCategory(results: PriceResult[], revenueBySku: Map<string, number>): CategorySummary[] {
  const groups = new Map<string, PriceResult[]>()
  for (const result of results) groups.set(result.category ?? 'sem categoria', [...(groups.get(result.category ?? 'sem categoria') ?? []), result])

  const totalRevenue = [...revenueBySku.values()].reduce((sum, value) => sum + value, 0)

  return [...groups.entries()]
    .map(([category, items]) => {
      const rated = items.filter(item => item.currentMargin !== null)
      const revenue = items.reduce((sum, item) => sum + (revenueBySku.get(item.sku) ?? 0), 0)
      const ratedRevenue = rated.reduce((sum, item) => sum + (revenueBySku.get(item.sku) ?? 0), 0)
      const margin = ratedRevenue > 0 ? rated.reduce((sum, item) => sum + (item.currentMargin as number) * (revenueBySku.get(item.sku) ?? 0), 0) / ratedRevenue : null
      const target = items[0].targetMargin

      return { category, averageMargin: margin, targetMargin: target, difference: margin === null ? null : margin - target, revenueCents: revenue, revenueShare: totalRevenue > 0 ? revenue / totalRevenue : 0, products: items.length }
    })
    .sort((a, b) => b.revenueCents - a.revenueCents)
}

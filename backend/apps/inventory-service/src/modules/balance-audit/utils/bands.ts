import type { AuditBands, StoreMonthSales, TurnoverBand } from './audit-types'

export const DEFAULT_BANDS: AuditBands = {
  turnover: { highMin: 20, mediumMin: 5 },
  balanceUpperBounds: [0, 5, 15, 40],
}

/** Labels follow the bounds, e.g. [0,5,15,40] → '0', '1–5', '6–15', '16–40', '41+'; below zero is its own band. */
export function balanceBandLabels(bands: AuditBands): string[] {
  const labels = ['<0']
  let lower = 0

  bands.balanceUpperBounds.forEach((upper, index) => {
    labels.push(index === 0 ? String(upper) : `${lower + 1}–${upper}`)
    lower = upper
  })

  labels.push(`${lower + 1}+`)
  return labels
}

export function balanceBand(balance: number, bands: AuditBands): string {
  const labels = balanceBandLabels(bands)
  if (balance < 0) return labels[0]

  for (let i = 0; i < bands.balanceUpperBounds.length; i++) {
    if (balance <= bands.balanceUpperBounds[i]) return labels[i + 1]
  }

  return labels[labels.length - 1]
}

export function turnoverBandLabels(): TurnoverBand[] {
  return ['high', 'medium', 'low', 'no_sales', 'unknown']
}

/**
 * Turnover of one store × SKU: mean monthly units sold over the months of the
 * audited range that have imported sales for the store. A store with no
 * imported month has no stated turnover ('unknown') — treating it as 'no_sales'
 * would say the SKU did not sell when the truth is the sales were never loaded.
 */
export function turnoverBand(storeId: number, sku: string, sales: StoreMonthSales[], bands: AuditBands): TurnoverBand {
  const months = sales.filter(month => month.storeId === storeId && month.present)
  if (months.length === 0) return 'unknown'

  const total = months.reduce((sum, month) => sum + (month.bySku.get(sku) ?? 0), 0)
  const monthly = total / months.length

  if (monthly <= 0) return 'no_sales'
  if (monthly >= bands.turnover.highMin) return 'high'
  if (monthly >= bands.turnover.mediumMin) return 'medium'
  return 'low'
}

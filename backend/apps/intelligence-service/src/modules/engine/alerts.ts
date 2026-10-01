import type { Parameters } from '../parameters/parameters.types'
import type { MonthlyFacts, NetworkEvidence } from './engine.types'
import type { Pattern } from './pattern'
import type { Economics } from './mix'

export type AlertCode = 'expiry_attention' | 'investigate_damage' | 'investigate_losses' | 'review_balance' | 'incomplete_data'

export interface Alert {
  code: AlertCode
  /** Facts that triggered it. No cause is inferred — "other reason" is never theft. */
  detail: Record<string, unknown>
  /** For expiry only: stronger when demand is low or declining. */
  severity?: 'normal' | 'high'
  /** For damage only: how widespread it is. */
  scope?: 'local' | 'several_stores' | 'network'
}

/**
 * The last three months in which the SKU was PRESENT at the store — restocked,
 * sold or removed. Calendar months are the wrong window: a product that stopped
 * being restocked in June must still be judged on March to May, not on three
 * empty months that hide its recurring expiry.
 */
export function presenceMonths(monthly: MonthlyFacts[], count = 3): MonthlyFacts[] {
  return [...monthly]
    .sort((a, b) => a.month.localeCompare(b.month))
    .filter(month => month.restocked > 0 || month.sold > 0 || Object.values(month.removals).some(units => (units ?? 0) > 0))
    .slice(-count)
}

const lastThree = (monthly: MonthlyFacts[]) => presenceMonths(monthly)

export const monthsWith = (months: MonthlyFacts[], reason: keyof MonthlyFacts['removals']): number =>
  months.filter(month => (month.removals[reason] ?? 0) > 0).length

export function expiredIsRecurrent(monthly: MonthlyFacts[], p: Parameters['alerts']): boolean {
  return monthsWith(lastThree(monthly), 'expired') >= p.expiredMonthsOfThree
}

export interface AlertInput {
  monthly: MonthlyFacts[]
  pattern: Pattern
  lowDemand: boolean
  economics: Economics
  network: NetworkEvidence | null
  toleranceOutside: boolean
  recurringAdjustment: boolean
  salesMonthsMissing: string[]
  rejectedAtIngestion: boolean
  parameters: Parameters['alerts']
}

/**
 * Operational alerts as FACTS. Expiry uses the recurrence of expired loss (shelf
 * life is not recorded for any product, so no prazo-based alert exists); damage
 * is never assumed to be a demand problem; "other reason" keeps that label and is
 * never inferred as theft. Splitting and capacity alerts are off while package
 * size and capacity are unknown — the result says so as a limitation.
 */
export function buildAlerts(input: AlertInput): Alert[] {
  const alerts: Alert[] = []
  const recent = lastThree(input.monthly)
  const p = input.parameters

  const expiredMonths = monthsWith(recent, 'expired')
  if (expiredMonths >= p.expiredMonthsOfThree) {
    alerts.push({
      code: 'expiry_attention',
      severity: input.lowDemand || input.pattern === 'declining' ? 'high' : 'normal',
      detail: { monthsWithExpiry: expiredMonths, units: recent.reduce((sum, month) => sum + (month.removals.expired ?? 0), 0) },
    })
  }

  const damagedMonths = monthsWith(recent, 'damaged_product')
  if (damagedMonths >= p.damagedMonthsOfThree) {
    const stores = input.network?.storesWithDamage ?? 1
    const exposed = input.network?.exposedStores ?? 1
    alerts.push({
      code: 'investigate_damage',
      scope: stores <= 1 ? 'local' : stores > exposed / 2 ? 'network' : 'several_stores',
      detail: { monthsWithDamage: damagedMonths, storesWithDamage: stores },
    })
  }

  const restocked = recent.reduce((sum, month) => sum + month.restocked, 0)
  const other = recent.reduce((sum, month) => sum + (month.removals.other_reason ?? 0), 0)
  if (restocked > 0 && other / restocked >= p.otherReasonShareOfRestocked) {
    alerts.push({ code: 'investigate_losses', detail: { otherReasonUnits: other, restockedUnits: restocked, share: other / restocked } })
  }

  if (input.toleranceOutside || input.recurringAdjustment) {
    alerts.push({ code: 'review_balance', detail: { toleranceOutside: input.toleranceOutside, recurringAdjustment: input.recurringAdjustment } })
  }

  if (input.salesMonthsMissing.length > 0 || input.rejectedAtIngestion) {
    alerts.push({ code: 'incomplete_data', detail: { salesMonthsMissing: input.salesMonthsMissing, rejectedAtIngestion: input.rejectedAtIngestion } })
  }

  return alerts
}

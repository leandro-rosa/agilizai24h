import type { Parameters } from '../parameters/parameters.types'
import type { BalanceEstimate } from './balance'
import type { DemandEstimate } from './demand'
import type { Economics } from './mix'
import type { Pattern } from './pattern'
import type { QuantityDecision } from './quantity'

export type Level = 'high' | 'medium' | 'low'

export interface Confidence {
  recommendation: { level: Level; reasons: string[] }
  balanceReliability: { level: Level; reasons: string[] }
  priority: { valueCents: number | null; level: Level | null; reasons: string[] }
}

const ORDER: Level[] = ['low', 'medium', 'high']
const cap = (current: Level, ceiling: Level): Level => (ORDER.indexOf(current) <= ORDER.indexOf(ceiling) ? current : ceiling)

export interface ConfidenceInput {
  demand: DemandEstimate
  pattern: Pattern
  salesMonthsMissing: string[]
  conflicting: boolean
  balance: BalanceEstimate
  quantity: QuantityDecision
  economics: Economics
  costCents: number | null
  /** Units lost over the recent months, loss reasons only. */
  recentLostUnits: number
  parameters: Parameters
}

/**
 * Three SEPARATE values. Recommendation confidence comes from how much evidence
 * there is, with caps that only ever lower it; balance reliability comes from
 * the tolerance status, anchor and stock-outs; priority is in R$ and says
 * nothing about either. "High confidence, low balance reliability" is a valid
 * and expected combination.
 */
export function buildConfidence(input: ConfidenceInput): Confidence {
  const c = input.parameters.confidence
  const reasons: string[] = []

  let level: Level = input.demand.observations >= c.highIntervals ? 'high' : input.demand.observations >= c.mediumIntervals ? 'medium' : 'low'
  reasons.push(`${input.demand.observations} uncensored intervals observed`)

  const lower = (ceiling: Level, why: string) => {
    const next = cap(level, ceiling)
    if (next !== level) reasons.push(why)
    level = next
  }

  if (input.salesMonthsMissing.length > 0) lower('medium', `sales missing for ${input.salesMonthsMissing.length} month(s)`)
  if (input.pattern === 'volatile') lower('medium', 'volatile demand pattern')
  if (input.demand.demandCensored) lower('medium', 'frequent stock-outs: demand is a lower bound')
  if (input.conflicting) lower('low', 'conflicting data')
  if (input.quantity.baselineIsOfRecord) lower('medium', 'the baseline of the time is unknown; the baseline of record was used')

  // ---- balance reliability
  const balanceReasons: string[] = [`tolerance status: ${input.balance.tolerance.status}`]
  let balanceLevel: Level

  if (input.conflicting) {
    balanceLevel = 'low'
    balanceReasons.push('conflicting data')
  } else if (input.balance.tolerance.status === 'within_tolerance') {
    balanceLevel = input.balance.anchor?.type === 'counted' && !input.demand.demandCensored ? 'high' : 'medium'
    if (input.balance.anchor?.type !== 'counted') balanceReasons.push('the latest anchor is a system balance, not a count')
    if (input.demand.demandCensored) balanceReasons.push('recent stock-outs make the rate a lower bound')
  } else {
    balanceLevel = 'low'
    if (input.balance.tolerance.reason) balanceReasons.push(input.balance.tolerance.reason)
  }
  if (input.balance.tolerance.lastCountAgeDays !== null) balanceReasons.push(`last count ${Math.round(input.balance.tolerance.lastCountAgeDays)} days before the reference date`)

  // ---- priority (R$)
  const priorityReasons: string[] = []
  let valueCents: number | null = null

  if (input.costCents === null) {
    priorityReasons.push('cost unresolved: priority cannot be valued')
  } else {
    const excessUnits = input.quantity.action === 'reduce' && input.quantity.from !== null && input.quantity.to !== null ? input.quantity.from - input.quantity.to : 0
    valueCents = input.costCents * (excessUnits + input.recentLostUnits)
    priorityReasons.push(`${excessUnits} excess units and ${input.recentLostUnits} recently lost units at cost`)
  }

  const priorityLevel: Level | null =
    valueCents === null ? null : valueCents >= input.parameters.priority.highCents ? 'high' : valueCents >= input.parameters.priority.mediumCents ? 'medium' : 'low'

  return {
    recommendation: { level, reasons },
    balanceReliability: { level: balanceLevel, reasons: balanceReasons },
    priority: { valueCents, level: priorityLevel, reasons: priorityReasons },
  }
}

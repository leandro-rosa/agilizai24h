import { DEFAULT_PARAMETERS } from './parameters.defaults'
import type { DeepPartial, Parameters } from './parameters.types'

export class ParametersInvalidError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid parameters: ${problems.join('; ')}`)
  }
}

/** Overlays a partial document on a full one, group by group. Arrays replace, never merge. */
export function mergeParameters(base: Parameters, patch: DeepPartial<Parameters>): Parameters {
  const merged = structuredClone(base) as unknown as Record<string, Record<string, unknown>>

  for (const [group, entries] of Object.entries(patch)) {
    if (!(group in merged)) throw new ParametersInvalidError([`unknown group "${group}"`])
    if (entries === null || typeof entries !== 'object') throw new ParametersInvalidError([`"${group}" must be an object`])

    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      if (!(key in merged[group])) throw new ParametersInvalidError([`unknown parameter "${group}.${key}"`])
      merged[group][key] = value
    }
  }

  return merged as unknown as Parameters
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Returns every problem found, so a caller can fix them all at once. Empty means valid. */
export function validateParameters(parameters: Parameters): string[] {
  const problems: string[] = []
  const check = (ok: boolean, message: string) => {
    if (!ok) problems.push(message)
  }

  // Every number must be a real number, whatever else is checked.
  for (const [group, entries] of Object.entries(parameters)) {
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      if (key === 'visitWeekdays') continue
      check(isNumber(value), `${group}.${key} must be a number`)
      if (isNumber(value)) check(value >= 0, `${group}.${key} must not be negative`)
    }
  }

  const t = parameters.tolerance
  check(isNumber(t.pct) && t.pct <= 1, 'tolerance.pct is a fraction between 0 and 1')
  check(Number.isInteger(t.units), 'tolerance.units must be a whole number of units')
  check(Number.isInteger(t.windowCounts) && t.windowCounts >= 1, 'tolerance.windowCounts must be a whole number of at least 1')
  check(Number.isInteger(t.minCounts) && t.minCounts >= 1, 'tolerance.minCounts must be a whole number of at least 1')
  check(t.minCounts <= t.windowCounts, 'tolerance.minCounts cannot exceed tolerance.windowCounts — no balance could ever be verified')
  check(t.maxAgeDays >= 1, 'tolerance.maxAgeDays must be at least 1 day')

  check(parameters.demand.halfLifeDays > 0, 'demand.halfLifeDays must be positive')
  check(parameters.demand.minIntervalDays > 0, 'demand.minIntervalDays must be positive')
  check(parameters.demand.censoredShareFlag <= 1, 'demand.censoredShareFlag is a share between 0 and 1')

  check(parameters.pattern.tauThreshold > 0 && parameters.pattern.tauThreshold <= 1, 'pattern.tauThreshold must be in (0, 1]')
  check(parameters.pattern.minObservations >= 2, 'pattern.minObservations must be at least 2')

  check(parameters.quantity.censoredShareIncrease <= 1, 'quantity.censoredShareIncrease is a share between 0 and 1')
  check(parameters.quantity.lossLowShare <= 1, 'quantity.lossLowShare is a share between 0 and 1')

  check(parameters.mix.lowRecurrenceShare > 0 && parameters.mix.lowRecurrenceShare <= 1, 'mix.lowRecurrenceShare must be in (0, 1]')
  check(parameters.mix.networkMajorityShare >= 0.5 && parameters.mix.networkMajorityShare < 1, 'mix.networkMajorityShare must be a majority: at least 0.5 and below 1')
  check(parameters.mix.minExposureCycles >= 1, 'mix.minExposureCycles must be at least 1')

  // An inverted pair would make "medium" confidence unreachable.
  check(parameters.confidence.highIntervals > parameters.confidence.mediumIntervals, 'confidence.highIntervals must exceed confidence.mediumIntervals')

  check(parameters.priority.highCents > parameters.priority.mediumCents, 'priority.highCents must exceed priority.mediumCents')
  check(parameters.mix.lowContributionShare <= 1, 'mix.lowContributionShare is a share between 0 and 1')
  check(parameters.backtest.salesAtRiskShare <= 1, 'backtest.salesAtRiskShare is a share between 0 and 1')
  check(parameters.refresh.availableStoreShare > 0 && parameters.refresh.availableStoreShare <= 1, 'refresh.availableStoreShare must be in (0, 1]')

  check(isValidWeekdays(parameters.schedule.visitWeekdays), 'schedule.visitWeekdays must be a non-empty list of distinct ISO weekdays, 1 (Monday) to 7 (Sunday)')

  return problems
}

export function isValidWeekdays(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(day => Number.isInteger(day) && day >= 1 && day <= 7) &&
    new Set(value).size === value.length
  )
}

/** Merges a patch onto a base and validates the result; throws with every problem. */
export function buildParameters(base: Parameters, patch: DeepPartial<Parameters>): Parameters {
  const merged = mergeParameters(base, patch)
  const problems = validateParameters(merged)
  if (problems.length > 0) throw new ParametersInvalidError(problems)
  return merged
}

export { DEFAULT_PARAMETERS }

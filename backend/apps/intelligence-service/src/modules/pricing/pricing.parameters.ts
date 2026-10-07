import type { PricingParameters } from './pricing.types'

/** The owner's references. The 35% target is a starting value, never a constant: a new version replaces it. */
export const DEFAULT_PRICING_PARAMETERS: PricingParameters = {
  margin: { targetBps: 3500, minimumBps: 3000, categories: {} },
  taxRateBps: null,
  rounding: { stepCents: 10 },
  psychological: { enabled: false, endingCents: 90 },
  guards: { maxIncreaseBps: 1500, opportunityBandBps: 300 },
  data: { lookbackMonths: 3, minUnitsPerMonth: 10, voucherMinReceiptLines: 50, lossMinUnits: 100, costMaxAgeDays: 120, stableCostBps: 500 },
  minConfidence: 'low',
}

export class PricingParametersInvalidError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid pricing parameters: ${problems.join('; ')}`)
  }
}

type Patch = { [K in keyof PricingParameters]?: PricingParameters[K] extends object ? Partial<PricingParameters[K]> : PricingParameters[K] }

/** Overlays a partial change on a full document, group by group. Unknown keys are refused. */
export function mergePricingParameters(base: PricingParameters, patch: Patch): PricingParameters {
  const merged = structuredClone(base) as unknown as Record<string, unknown>

  for (const [key, value] of Object.entries(patch)) {
    if (!(key in merged)) throw new PricingParametersInvalidError([`unknown parameter "${key}"`])
    const current = merged[key]
    if (current !== null && typeof current === 'object' && !Array.isArray(current) && value !== null && typeof value === 'object') {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (!(inner in (current as object))) throw new PricingParametersInvalidError([`unknown parameter "${key}.${inner}"`])
        ;(current as Record<string, unknown>)[inner] = innerValue
      }
    } else {
      merged[key] = value
    }
  }

  return merged as unknown as PricingParameters
}

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

/** Every problem found, so a caller can fix them all at once. Empty means valid. */
export function validatePricingParameters(p: PricingParameters): string[] {
  const problems: string[] = []
  const check = (ok: boolean, message: string) => {
    if (!ok) problems.push(message)
  }
  const bps = (value: unknown, name: string) => check(isInt(value) && value >= 0 && value < 10_000, `${name} must be a whole number of basis points in [0, 10000)`)

  bps(p.margin.targetBps, 'margin.targetBps')
  bps(p.margin.minimumBps, 'margin.minimumBps')
  check(p.margin.minimumBps <= p.margin.targetBps, 'margin.minimumBps cannot exceed margin.targetBps')
  for (const [category, value] of Object.entries(p.margin.categories)) {
    if (value.targetBps !== undefined) bps(value.targetBps, `margin.categories.${category}.targetBps`)
    if (value.minimumBps !== undefined) bps(value.minimumBps, `margin.categories.${category}.minimumBps`)
    const target = value.targetBps ?? p.margin.targetBps
    const minimum = value.minimumBps ?? p.margin.minimumBps
    check(minimum <= target, `margin.categories.${category}: minimum cannot exceed target`)
  }
  if (p.taxRateBps !== null) bps(p.taxRateBps, 'taxRateBps')
  check(isInt(p.rounding.stepCents) && p.rounding.stepCents >= 1, 'rounding.stepCents must be a whole number of at least 1')
  check(typeof p.psychological.enabled === 'boolean', 'psychological.enabled must be true or false')
  check(isInt(p.psychological.endingCents) && p.psychological.endingCents >= 0 && p.psychological.endingCents <= 99, 'psychological.endingCents must be 0-99')
  bps(p.guards.maxIncreaseBps, 'guards.maxIncreaseBps')
  bps(p.guards.opportunityBandBps, 'guards.opportunityBandBps')
  check(isInt(p.data.lookbackMonths) && p.data.lookbackMonths >= 1 && p.data.lookbackMonths <= 24, 'data.lookbackMonths must be 1-24')
  for (const key of ['minUnitsPerMonth', 'voucherMinReceiptLines', 'lossMinUnits', 'costMaxAgeDays'] as const) {
    check(isInt(p.data[key]) && p.data[key] >= 0, `data.${key} must be a whole number, zero or more`)
  }
  bps(p.data.stableCostBps, 'data.stableCostBps')
  check(['low', 'medium', 'high'].includes(p.minConfidence), 'minConfidence must be low, medium or high')

  return problems
}

/** Target and minimum margin for a category, as fractions; the category override wins when set. */
export function marginsFor(p: PricingParameters, category: string | null): { target: number; minimum: number; fromCategory: boolean } {
  const override = category ? p.margin.categories[category] : undefined

  return {
    target: (override?.targetBps ?? p.margin.targetBps) / 10_000,
    minimum: (override?.minimumBps ?? p.margin.minimumBps) / 10_000,
    fromCategory: override !== undefined && (override.targetBps !== undefined || override.minimumBps !== undefined),
  }
}

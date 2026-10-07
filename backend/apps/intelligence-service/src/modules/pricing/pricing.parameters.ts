import { isLockedComponent } from './operating-costs'
import { OPERATING_CLASSES, type OperatingClass, type PricingParameters } from './pricing.types'

/**
 * A PROPOSAL of the class of each real account of the chart, for the owner to confirm in the rules (not a fact). Left out on purpose, so they show as
 * unclassified until someone decides: Degustações (4.2.06) and Marketing (4.2.07), which can be fixed or follow sales.
 */
export const DEFAULT_ACCOUNT_BEHAVIOR: Record<string, OperatingClass> = {
  '4.1.01': 'already_component', // purchases for the stores: the product cost
  '4.1.02': 'other_revenue_cost', // coffee break purchases: never in the price of a product
  '4.1.03': 'other_revenue_cost', // fruit purchases: never in the price of a product
  '4.2.01': 'percent_of_sales', // Repasse de vendas (a percentage of the store's own sales)
  '4.2.02': 'already_component', // losses: the loss component
  '4.2.03': 'per_visit', // Deslocamento (carries Gasolina, Pedágio, Alimentação)
  '4.3.01': 'fixed', // Mensalidade touchpay
  '4.3.02': 'fixed', // Contador
  '4.3.03': 'fixed', // Pró-labore
  '4.3.04': 'fixed', // Luz
  '4.3.05': 'fixed', // ERP Conta Azul
}

/** The owner's references. The 35% target is a starting value, never a constant: a new version replaces it. */
export const DEFAULT_PRICING_PARAMETERS: PricingParameters = {
  margin: { targetBps: 3500, minimumBps: 3000, categories: {} },
  taxRateBps: null,
  rounding: { stepCents: 10 },
  psychological: { enabled: false, endingCents: 90 },
  guards: { maxIncreaseBps: 1500, opportunityBandBps: 300 },
  data: { lookbackMonths: 3, minUnitsPerMonth: 10, voucherMinReceiptLines: 50, lossMinUnits: 100, costMaxAgeDays: 120, stableCostBps: 500 },
  operating: { accountBehavior: DEFAULT_ACCOUNT_BEHAVIOR, unclassifiedRelevantBps: 50 },
  payment: { brandAliases: { sodexo: 'pluxee', pagseguro: 'pagbank' } },
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
  bps(p.operating.unclassifiedRelevantBps, 'operating.unclassifiedRelevantBps')
  for (const [code, behavior] of Object.entries(p.operating.accountBehavior)) {
    check(/^\d+(\.\d+)*$/.test(code), `operating.accountBehavior: "${code}" is not an account code`)
    check((OPERATING_CLASSES as readonly string[]).includes(behavior), `operating.accountBehavior.${code} must be one of ${OPERATING_CLASSES.join(', ')}`)
    // Tax, card fees, loss and purchases are already components of the price: mapping them elsewhere would count them twice.
    check(!isLockedComponent(code) || behavior === 'already_component', `operating.accountBehavior.${code} is already a component of the price and can only be already_component`)
  }
  for (const [from, to] of Object.entries(p.payment.brandAliases)) {
    check(typeof to === 'string' && to.length > 0 && from.length > 0, `payment.brandAliases.${from} must map to a non-empty brand`)
  }
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

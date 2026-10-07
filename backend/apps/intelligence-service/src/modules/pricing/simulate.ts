import type { CostStructure } from './price'

export interface Simulation {
  simulable: true
  priceCents: number
  /** The engine's economic margin at the typed price. */
  margin: number
  markup: number
  unitProfitCents: number
  currentPriceCents: number
  currentMargin: number
  /** Estimated change in R$ per month against the current price, volume held constant. */
  monthlyImpactCents: number
  /** Margin minus the target, in fraction points. */
  differenceToTarget: number
  targetMargin: number
  impactLabel: 'Impacto potencial estimado'
}

export interface NotSimulable {
  simulable: false
  reason: string
}

export class InvalidPriceError extends Error {}

/** A price is a positive whole number of centavos. */
export function assertPrice(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new InvalidPriceError('priceCents must be a positive whole number of centavos')

  return value
}

/**
 * The same arithmetic as the engine over the stored cost structure, so a simulated price and a recommended price are
 * comparable. Reads nothing and writes nothing.
 */
export function simulate(input: { structure: CostStructure | null; currentPriceCents: number | null; monthlyUnits: number; targetMargin: number; priceCents: number }): Simulation | NotSimulable {
  const { structure, currentPriceCents } = input
  if (!structure) return { simulable: false, reason: 'O produto não tem estrutura de custos calculada (dados insuficientes).' }
  if (currentPriceCents === null || currentPriceCents <= 0) return { simulable: false, reason: 'O produto não tem preço atual.' }

  const variableShare = structure.taxRate + structure.paymentRate + structure.operatingShare
  const unitCost = structure.lossAdjustedCostCents + structure.paymentFixedCents
  const unitProfit = (price: number) => price * (1 - variableShare) - unitCost
  const margin = unitProfit(input.priceCents) / input.priceCents

  return {
    simulable: true,
    priceCents: input.priceCents,
    margin,
    markup: input.priceCents / structure.productCostCents,
    unitProfitCents: unitProfit(input.priceCents),
    currentPriceCents,
    currentMargin: unitProfit(currentPriceCents) / currentPriceCents,
    monthlyImpactCents: input.monthlyUnits * (unitProfit(input.priceCents) - unitProfit(currentPriceCents)),
    differenceToTarget: margin - input.targetMargin,
    targetMargin: input.targetMargin,
    impactLabel: 'Impacto potencial estimado',
  }
}

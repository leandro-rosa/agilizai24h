import { marginsFor } from './pricing.parameters'
import { ANALYSIS_ONLY_STATEMENT, ENGINE_VERSION, type Confidence, type LossLevel, type PaymentCost, type PricingParameters, type PricingStatus } from './pricing.types'

export interface PriceInput {
  sku: string
  name?: string | null
  category?: string | null
  /** Acquisition cost per unit. `null` = no cost registered. */
  costCents: number | null
  /** Age of that cost in days, and whether it came from a real purchase. */
  costAgeDays: number | null
  costFromPurchase: boolean
  costFlaggedUnreliable: boolean
  /** The cost before the latest change, for the variation and the stability of the cost. */
  previousCostCents: number | null
  currentPriceCents: number | null
  /** Average units sold per month over the window. */
  monthlyUnits: number
  /** True when units fell clearly after the latest price increase. */
  volumeDroppedAfterPriceChange: boolean
  loss: { rate: number; level: LossLevel } | null
  payment: PaymentCost | null
  /** Operating allocation as a fraction of revenue, from accounting. `null` = unavailable. */
  operatingShare: number | null
  params: PricingParameters
}

export interface CostStructure {
  productCostCents: number
  /** Product cost per sold unit once the lost units are carried by the sold ones. */
  lossAdjustedCostCents: number
  taxRate: number
  lossRate: number
  lossLevel: LossLevel
  paymentRate: number
  voucherShare: number
  voucherBasis: string
  operatingShare: number
  /** What the prices below are solved against. */
  statement: string
}

export interface Reason {
  code: string
  text: string
}

export interface PriceResult {
  sku: string
  name: string | null
  category: string | null
  status: PricingStatus
  confidence: Confidence
  /** `null` when insufficient data or below the minimum confidence. */
  minimumPriceCents: number | null
  targetPriceCents: number | null
  recommendedPriceCents: number | null
  currentPriceCents: number | null
  currentMargin: number | null
  currentMarkup: number | null
  targetMargin: number
  minimumMargin: number
  marginFromCategory: boolean
  structure: CostStructure | null
  costVariation: number | null
  monthlyUnits: number
  /** Margin in R$ per month at the current price. */
  monthlyMarginCents: number | null
  /** Estimated change in R$ per month, volume held constant. An estimate, never a guaranteed profit. */
  impactCentsPerMonth: number | null
  impactLabel: 'Impacto potencial estimado'
  recommendedMargin: number | null
  reasons: Reason[]
  insufficientReasons: string[]
  engineVersion: string
}

const CONFIDENCE_RANK: Record<Exclude<Confidence, 'insufficient_data'>, number> = { low: 0, medium: 1, high: 2 }

/** Price at which, after tax, payment fee and operating share, `margin` of it remains as profit. */
export function priceForMargin(costCents: number, variableShare: number, margin: number): number | null {
  const denominator = 1 - variableShare - margin
  if (denominator <= 0.000001) return null

  return costCents / denominator
}

function roundUp(cents: number, step: number): number {
  return Math.ceil(cents / step - 1e-9) * step
}

/** Smallest price >= `cents` that ends in `ending` cents (e.g. x,90) and respects the rounding step as a floor. */
function psychological(cents: number, ending: number): number {
  const base = Math.floor(cents / 100) * 100 + ending
  return base >= Math.ceil(cents - 1e-9) ? base : base + 100
}

export function shapePrice(rawCents: number, params: PricingParameters): number {
  const stepped = roundUp(rawCents, params.rounding.stepCents)
  return params.psychological.enabled ? psychological(stepped, params.psychological.endingCents) : stepped
}

function insufficient(input: PriceInput, reasons: string[], margins: ReturnType<typeof marginsFor>): PriceResult {
  return {
    sku: input.sku,
    name: input.name ?? null,
    category: input.category ?? null,
    status: 'insufficient_data',
    confidence: 'insufficient_data',
    minimumPriceCents: null,
    targetPriceCents: null,
    recommendedPriceCents: null,
    currentPriceCents: input.currentPriceCents,
    currentMargin: null,
    currentMarkup: input.costCents && input.currentPriceCents ? input.currentPriceCents / input.costCents : null,
    targetMargin: margins.target,
    minimumMargin: margins.minimum,
    marginFromCategory: margins.fromCategory,
    structure: null,
    costVariation: null,
    monthlyUnits: input.monthlyUnits,
    monthlyMarginCents: null,
    impactCentsPerMonth: null,
    impactLabel: 'Impacto potencial estimado',
    recommendedMargin: null,
    reasons: [],
    insufficientReasons: reasons,
    engineVersion: ENGINE_VERSION,
  }
}

const pct = (value: number) => `${(value * 100).toFixed(1).replace('.', ',')}%`

export function computePrice(input: PriceInput): PriceResult {
  const { params } = input
  const margins = marginsFor(params, input.category ?? null)

  const missing: string[] = []
  if (input.costCents === null || input.costCents <= 0) missing.push('Sem custo cadastrado')
  else if (input.costFlaggedUnreliable) missing.push('Custo marcado como não confiável')
  // A cost version stays in force until a new one is registered, so its age alone is not staleness: only an old
  // cost with no purchase in the window is too old to trust.
  else if (!input.costFromPurchase && input.costAgeDays !== null && input.costAgeDays > params.data.costMaxAgeDays) missing.push(`Custo desatualizado (${input.costAgeDays} dias, sem compra no período)`)
  if (params.taxRateBps === null) missing.push('Alíquota de imposto não configurada')
  if (!input.payment) missing.push('Sem vendas para calcular o custo de pagamento')
  if (!input.loss) missing.push('Sem histórico de perda')
  if (input.operatingShare === null) missing.push('Rateio operacional indisponível')
  if (input.currentPriceCents === null || input.currentPriceCents <= 0) missing.push('Sem preço atual')
  if (missing.length > 0) return insufficient(input, missing, margins)

  const cost = input.costCents as number
  const current = input.currentPriceCents as number
  const payment = input.payment as PaymentCost
  const loss = input.loss as { rate: number; level: LossLevel }
  const operatingShare = input.operatingShare as number
  const taxRate = (params.taxRateBps as number) / 10_000

  const lossAdjusted = cost / (1 - loss.rate)
  const variableShare = taxRate + payment.rate + operatingShare

  const structure: CostStructure = {
    productCostCents: cost,
    lossAdjustedCostCents: lossAdjusted,
    taxRate,
    lossRate: loss.rate,
    lossLevel: loss.level,
    paymentRate: payment.rate,
    voucherShare: payment.voucherShare,
    voucherBasis: payment.voucherBasis,
    operatingShare,
    statement: ANALYSIS_ONLY_STATEMENT,
  }

  const reasons: Reason[] = []
  const unitProfit = (price: number) => price * (1 - variableShare) - lossAdjusted
  const marginAt = (price: number) => unitProfit(price) / price

  const currentMargin = marginAt(current)
  const rawMinimum = priceForMargin(lossAdjusted, variableShare, margins.minimum)
  const rawTarget = priceForMargin(lossAdjusted, variableShare, margins.target)

  if (rawMinimum === null || rawTarget === null) {
    const result = insufficient(input, ['A estrutura de custos consome toda a margem: nenhum preço atinge a meta'], margins)
    return { ...result, status: 'review', confidence: 'low', structure, currentMargin, reasons: [] }
  }

  const minimumPrice = shapePrice(rawMinimum, params)
  const targetPrice = shapePrice(rawTarget, params)

  const costVariation = input.previousCostCents && input.previousCostCents > 0 ? (cost - input.previousCostCents) / input.previousCostCents : null
  const belowTarget = currentMargin < margins.target - 1e-9

  let recommended = current
  let status: PricingStatus = 'healthy'

  if (belowTarget) {
    const ceiling = roundUp(current * (1 + params.guards.maxIncreaseBps / 10_000), params.rounding.stepCents)
    const capped = targetPrice > ceiling
    recommended = Math.max(Math.min(targetPrice, ceiling), current)

    if (input.volumeDroppedAfterPriceChange) {
      status = 'review'
      recommended = current
      reasons.push({ code: 'volume_dropped', text: 'As vendas caíram depois do último reajuste; avalie preço e custo antes de aumentar' })
    } else {
      status = 'adjust'
      reasons.push({ code: 'below_target', text: `Margem atual de ${pct(currentMargin)}, abaixo da meta de ${pct(margins.target)}` })
      if (capped) reasons.push({ code: 'increase_capped', text: `O aumento até a meta passa de ${pct(params.guards.maxIncreaseBps / 10_000)}; recomendado em etapas` })
      else reasons.push({ code: 'price_recovers_margin', text: 'O preço recomendado recupera a margem' })
    }
  } else if (currentMargin < margins.target + params.guards.opportunityBandBps / 10_000 && input.monthlyUnits >= params.data.minUnitsPerMonth && !input.volumeDroppedAfterPriceChange) {
    status = 'opportunity'
    recommended = shapePrice(current + params.rounding.stepCents, params)
    reasons.push({ code: 'near_target_volume', text: 'Margem próxima da meta e bom volume; um pequeno reajuste tem impacto relevante' })
  } else {
    reasons.push({ code: 'on_target', text: `Margem de ${pct(currentMargin)} dentro da meta de ${pct(margins.target)}` })
  }

  if (costVariation !== null && Math.abs(costVariation) >= params.data.stableCostBps / 10_000) {
    reasons.push({ code: 'cost_moved', text: `Custo ${costVariation > 0 ? 'aumentou' : 'caiu'} ${pct(Math.abs(costVariation))} em relação ao anterior` })
  }
  if (input.monthlyUnits >= params.data.minUnitsPerMonth * 3) reasons.push({ code: 'volume_high', text: 'Produto com volume de vendas elevado' })
  reasons.push({ code: 'loss_level', text: `Perda de ${pct(loss.rate)} (${loss.level === 'product' ? 'do produto' : `${loss.level} — histórico próprio insuficiente`})` })

  // Confidence: a small explicit rubric, no false precision.
  let points = 0
  points += input.costFromPurchase && (input.costAgeDays ?? Infinity) <= params.data.costMaxAgeDays / 2 ? 2 : 1
  points += input.monthlyUnits >= params.data.minUnitsPerMonth * 3 ? 2 : input.monthlyUnits >= params.data.minUnitsPerMonth ? 1 : 0
  const unstable = costVariation !== null && Math.abs(costVariation) > params.data.stableCostBps / 10_000 * 3
  points += costVariation === null ? 1 : unstable ? 0 : Math.abs(costVariation) <= params.data.stableCostBps / 10_000 ? 2 : 1
  points += payment.complete && payment.voucherBasis !== 'simple_average' ? 2 : payment.complete ? 1 : 0
  points += loss.level === 'product' ? 2 : loss.level === 'category' ? 1 : 0

  let confidence: Exclude<Confidence, 'insufficient_data'> = points >= 8 ? 'high' : points >= 5 ? 'medium' : 'low'
  if (input.monthlyUnits < params.data.minUnitsPerMonth) {
    confidence = 'low'
    reasons.push({ code: 'few_sales', text: 'Poucas vendas no período; recomendação com baixa confiança' })
  }

  const belowMinConfidence = CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[params.minConfidence]
  let shown: number | null = recommended
  if (belowMinConfidence) {
    shown = null
    if (status === 'adjust' || status === 'opportunity') status = 'review'
    reasons.push({ code: 'below_min_confidence', text: 'Confiança abaixo do mínimo configurado; sem recomendação de preço' })
  }

  const impact = shown === null ? null : input.monthlyUnits * (unitProfit(shown) - unitProfit(current))

  return {
    sku: input.sku,
    name: input.name ?? null,
    category: input.category ?? null,
    status,
    confidence,
    minimumPriceCents: minimumPrice,
    targetPriceCents: targetPrice,
    recommendedPriceCents: shown,
    currentPriceCents: current,
    currentMargin,
    currentMarkup: current / cost,
    targetMargin: margins.target,
    minimumMargin: margins.minimum,
    marginFromCategory: margins.fromCategory,
    structure,
    costVariation,
    monthlyUnits: input.monthlyUnits,
    monthlyMarginCents: input.monthlyUnits * unitProfit(current),
    impactCentsPerMonth: impact,
    impactLabel: 'Impacto potencial estimado',
    recommendedMargin: shown === null ? null : marginAt(shown),
    reasons,
    insufficientReasons: [],
    engineVersion: ENGINE_VERSION,
  }
}

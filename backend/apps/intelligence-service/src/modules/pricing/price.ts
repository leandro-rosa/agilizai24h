import { categoryLabel } from './categories'
import { PER_TRANSACTION_SHIFT_LABEL, type LegacyShift } from './operating-costs'
import { marginsFor } from './pricing.parameters'
import { ANALYSIS_ONLY_STATEMENT, ENGINE_VERSION, type Confidence, type LossLevel, type PaymentCost, type PricingParameters, type PricingStatus } from './pricing.types'

export interface PriceInput {
  sku: string
  name?: string | null
  category?: string | null
  /** The category's name in the registry (managed data); absent = the built-in label. */
  categoryName?: string | null
  subcategory?: string | null
  ean?: string | null
  /** Declared supplier; none when the catalogue has none. */
  supplierId?: number | null
  supplierName?: string | null
  /** The day a product registered from an invoice was registered, when that day falls inside the analysed window: it is a NEW product to this report. */
  newProductOn?: string | null
  /** Acquisition cost per unit. `null` = no cost registered. */
  costCents: number | null
  /** Age of that cost in days, and whether it came from a real purchase. */
  costAgeDays: number | null
  costFromPurchase: boolean
  /**
   * Where the cost in force really came from (the version's source, its day and, for an invoice, its number). When present it decides whether the
   * cost is backed by an invoice; `costFromPurchase` (a purchase in the window) then only keeps deciding whether an old cost is stale.
   */
  costOrigin?: { source: string; effectiveFrom: string; invoiceNumber: string | null } | null
  costFlaggedUnreliable: boolean
  /** A cost recorded AFTER the end of the analysed period (the period is history; this is not part of it). `basis` says what kind of cost it is. */
  newerCost?: { costCents: number; effectiveFrom: string; source: string; basis?: CostBasis } | null
  /** The cost of the last RECEIVED purchase (with or without an invoice) up to today, by the day it was received; null when there is none. A cost basis of its own. */
  lastPurchaseCost?: { costCents: number; effectiveFrom: string; invoiceNumber: string | null } | null
  /** The cost before the latest change, for the variation and the stability of the cost. */
  previousCostCents: number | null
  /** The cadastral or manual cost in force today, when it is not a received purchase (a basis of its own, never labelled a purchase). */
  registryCost?: { costCents: number; effectiveFrom: string; source: string } | null
  currentPriceCents: number | null
  /** Average units sold per month over the window. */
  monthlyUnits: number
  /** Average revenue per month over the window, in centavos; `null` when sales were not read. */
  monthlyRevenueCents?: number | null
  /** True when units fell clearly after the latest price increase. */
  volumeDroppedAfterPriceChange: boolean
  loss: { rate: number; level: LossLevel } | null
  payment: PaymentCost | null
  /** Expenses that follow the sales value (percentage of sales), as a fraction of revenue, from accounting. `null` = unavailable. */
  operatingShare: number | null
  /** Per-transaction expenses distributed per sold unit, in centavos (added to the numerator, never multiplied by the loss). Zero when no account is of that class. */
  perTransactionPerUnitCents?: number
  /** How the operating costs were classified, for the viability figures and the validation flag. Absent = the classification is unknown and nothing is validated. */
  operating?: OperatingContext | null
  params: PricingParameters
}

/** What kind of number a cost is: never read a cadastral or manual cost as a confirmed purchase. */
export type CostBasis = 'received_purchase' | 'registry_or_manual'

export const costBasisOf = (source: string | null | undefined): CostBasis => (source === 'invoice' ? 'received_purchase' : 'registry_or_manual')

/** The classification of the operating costs the price rests on, carried to the result. */
export interface OperatingContext {
  /** Per-visit and fixed costs over store revenue: NOT in the price, used only for the "result after allocation" figure. */
  perVisitShare: number
  fixedShare: number
  complete: boolean
  unclassifiedCents: number
  unclassifiedShare: number
  unclassified: { code: string; label: string; amountCents: number }[]
  months: string[]
  /** Words for the hypothesis behind the per-transaction cost, when there is one. */
  perTransactionAssumption: string | null
  scope: string
  /** What the OLD method charged (every variable and fixed expense but loss, over store revenue) and where each class moved it: for the reconciliation. */
  legacyShare: number
  shifts: LegacyShift[]
  perTransactionLegacyShare: number
}

/** The old economic margin, the new contribution margin, and every difference between them in its own line; whatever is left is "não explicado". */
export interface Reconciliation {
  oldMargin: number
  newMargin: number
  lines: { label: string; points: number }[]
  /** `new − old − Σ lines`: zero when the comparison explains everything. */
  unexplainedPoints: number
}

export interface CostStructure {
  productCostCents: number
  /** Product cost per sold unit once the lost units are carried by the sold ones. */
  lossAdjustedCostCents: number
  taxRate: number
  lossRate: number
  lossLevel: LossLevel
  paymentRate: number
  /** Fixed payment fees per sold unit, in centavos, added on top of the percentage fees. */
  paymentFixedCents: number
  voucherShare: number
  voucherBasis: string
  /** Expenses that follow sales value, as a fraction of the price (the CONTRIBUTION margin removes them like tax and fees). */
  operatingShare: number
  /** Per-transaction expenses per sold unit, in centavos; absent on a report stored before `pricing-4` (read it as zero). */
  perTransactionCents?: number
  /** What the prices below are solved against. */
  statement: string
}

export interface CostBases {
  historical: { costCents: number; effectiveFrom: string; source: string | null; basis: CostBasis } | null
  lastPurchase: { costCents: number; effectiveFrom: string; invoiceNumber: string | null } | null
  registry: { costCents: number; effectiveFrom: string; source: string } | null
}

export interface AtCost {
  basis: CostBasis
  costCents: number
  effectiveFrom: string
  targetPriceCents: number | null
  marginAtCurrentPrice: number | null
}

export interface ResultAfterAllocation {
  /** Centavos per unit at the current price. */
  centsPerUnit: number
  margin: number
  /** The criterion, visible: which costs were spread and over what. */
  criterion: string
}

export interface Reason {
  code: string
  text: string
}

export interface PriceResult {
  sku: string
  name: string | null
  ean: string | null
  supplierId: number | null
  supplierName: string | null
  /** The catalogue key (`beverage`...) and its Portuguese label; margin overrides are keyed by the key. */
  category: string | null
  categoryLabel: string
  subcategory: string | null
  /** A cost the registry holds from after the period's end: shown beside the period's cost, never as the period's cost. */
  newerCost: { costCents: number; effectiveFrom: string; source: string; basis: CostBasis } | null
  /**
   * The cost bases, kept apart: the historical cost the diagnosis uses (in force on the last day of the period), the last received purchase (with or
   * without an invoice) and the cadastral or manual cost in force today. A manual version is never labelled a confirmed purchase.
   */
  costBases: CostBases
  /** The diagnosis redone at the last received purchase cost ("current suggestion"), when that cost differs from the period's. */
  atLastPurchaseCost: AtCost | null
  /** The origin of the cost in force, as the products registry states it; null when it is not known. */
  costOrigin: { source: string; effectiveFrom: string; invoiceNumber: string | null } | null
  /** Registered from an invoice inside the analysed window ("Produto novo"); `noSalesHistory` when it has not sold in it. Null for every other product. */
  newProduct: { registeredOn: string; noSalesHistory: boolean } | null
  status: PricingStatus
  confidence: Confidence
  /** `null` when insufficient data or below the minimum confidence. */
  minimumPriceCents: number | null
  targetPriceCents: number | null
  recommendedPriceCents: number | null
  currentPriceCents: number | null
  /** The CONTRIBUTION margin at the current price: after cost with loss, tax, payment fees, per-sale and percentage-of-sales expenses. The target applies to it. */
  currentMargin: number | null
  /** What each sale contributes toward the fixed structure, in centavos per unit, at the current price. */
  unitContributionCents: number | null
  /** The contribution minus the per-visit and fixed costs spread over store revenue: a complementary figure, never "net profit", with its criterion in the text. */
  estimatedResultAfterAllocation: ResultAfterAllocation | null
  /** False when expenses relevant to the price have no treatment yet: the number is shown, but never as validated. */
  validated: boolean
  validationNotes: string[]
  /** Why the margin differs from the one the previous model (pricing-3) showed, line by line. Null without a classification. */
  reconciliation: Reconciliation | null
  currentMarkup: number | null
  targetMargin: number
  minimumMargin: number
  marginFromCategory: boolean
  structure: CostStructure | null
  costVariation: number | null
  /** The economic margin at the current price had the cost not changed, and the change the cost caused, in fraction points. */
  marginAtPreviousCost: number | null
  marginChangeFromCost: number | null
  monthlyUnits: number
  monthlyRevenueCents: number | null
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

function identity(input: PriceInput) {
  return {
    sku: input.sku,
    name: input.name ?? null,
    ean: input.ean ?? null,
    supplierId: input.supplierId ?? null,
    supplierName: input.supplierName ?? null,
    category: input.category ?? null,
    categoryLabel: categoryLabel(input.category, input.categoryName),
    subcategory: input.subcategory ?? null,
    costOrigin: input.costOrigin ?? null,
    newerCost: input.newerCost ? { ...input.newerCost, basis: input.newerCost.basis ?? costBasisOf(input.newerCost.source) } : null,
    costBases: {
      historical: input.costCents !== null && input.costOrigin ? { costCents: input.costCents, effectiveFrom: input.costOrigin.effectiveFrom, source: input.costOrigin.source, basis: costBasisOf(input.costOrigin.source) } : null,
      lastPurchase: input.lastPurchaseCost ?? null,
      registry: input.registryCost ?? null,
    },
    newProduct: input.newProductOn ? { registeredOn: input.newProductOn, noSalesHistory: input.monthlyUnits <= 0 } : null,
  }
}

function insufficient(input: PriceInput, reasons: string[], margins: ReturnType<typeof marginsFor>): PriceResult {
  return {
    ...identity(input),
    status: 'insufficient_data',
    confidence: 'insufficient_data',
    minimumPriceCents: null,
    targetPriceCents: null,
    recommendedPriceCents: null,
    currentPriceCents: input.currentPriceCents,
    currentMargin: null,
    unitContributionCents: null,
    estimatedResultAfterAllocation: null,
    validated: false,
    validationNotes: ['Dados insuficientes: sem recomendação'],
    reconciliation: null,
    atLastPurchaseCost: null,
    currentMarkup: input.costCents && input.currentPriceCents ? input.currentPriceCents / input.costCents : null,
    targetMargin: margins.target,
    minimumMargin: margins.minimum,
    marginFromCategory: margins.fromCategory,
    structure: null,
    costVariation: null,
    marginAtPreviousCost: null,
    marginChangeFromCost: null,
    monthlyUnits: input.monthlyUnits,
    monthlyRevenueCents: input.monthlyRevenueCents ?? null,
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
const money = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`

/**
 * The cost structure and the prices that solve it, for ONE set of inputs. Shared by the recommendation of a product that sells and by the
 * suggestion for a new one, so there is a single formula:
 *
 *   price = (cost ÷ (1 − loss) + fixed payment fee + per-transaction cost per unit) ÷ (1 − tax − payment % − percentage-of-sales expenses − margin)
 *
 * The percentages come off the price (the denominator); the per-sale and per-transaction amounts are money per sold unit added to the numerator, and only
 * the cost of the goods is multiplied by the loss (a lost unit is never sold, so it never pays a sale fee). When the percentages and the margin add up to
 * 100% or more the target cannot be reached by this formula, and `unreachable` says so instead of returning a price.
 */
export function solveStructure(
  input: { costCents: number; taxRateBps: number; payment: PaymentCost; loss: { rate: number; level: LossLevel }; operatingShare: number; perTransactionPerUnitCents?: number },
  margins: ReturnType<typeof marginsFor>,
) {
  const cost = input.costCents
  const taxRate = input.taxRateBps / 10_000
  const lossAdjusted = cost / (1 - input.loss.rate)
  const fixedPerUnit = input.payment.fixedPerUnitCents
  const perTransaction = input.perTransactionPerUnitCents ?? 0
  const unitCost = lossAdjusted + fixedPerUnit + perTransaction
  const variableShare = taxRate + input.payment.rate + input.operatingShare

  const structure: CostStructure = {
    productCostCents: cost,
    lossAdjustedCostCents: lossAdjusted,
    taxRate,
    lossRate: input.loss.rate,
    lossLevel: input.loss.level,
    paymentRate: input.payment.rate,
    paymentFixedCents: fixedPerUnit,
    voucherShare: input.payment.voucherShare,
    voucherBasis: input.payment.voucherBasis,
    operatingShare: input.operatingShare,
    perTransactionCents: perTransaction,
    statement: ANALYSIS_ONLY_STATEMENT,
  }
  const unitProfit = (price: number) => price * (1 - variableShare) - unitCost
  const rawTarget = priceForMargin(unitCost, variableShare, margins.target)

  return {
    cost,
    structure,
    unitCost,
    variableShare,
    unitProfit,
    marginAt: (price: number) => unitProfit(price) / price,
    rawMinimum: priceForMargin(unitCost, variableShare, margins.minimum),
    rawTarget,
    /** Why no price exists, in words; null when the target is reachable. */
    unreachable:
      rawTarget === null
        ? `A meta de ${pct(margins.target)} não é alcançável pela fórmula: imposto, taxas e despesas proporcionais à venda somam ${pct(variableShare)} do preço e, com a meta, passam de 100%`
        : null,
  }
}

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

  const current = input.currentPriceCents as number
  const solved = solveStructure(
    {
      costCents: input.costCents as number,
      taxRateBps: params.taxRateBps as number,
      payment: input.payment as PaymentCost,
      loss: input.loss as { rate: number; level: LossLevel },
      operatingShare: input.operatingShare as number,
      perTransactionPerUnitCents: input.perTransactionPerUnitCents ?? 0,
    },
    margins,
  )
  const { cost, structure, variableShare, unitProfit, marginAt, rawMinimum, rawTarget, unreachable } = solved
  const payment = input.payment as PaymentCost
  const loss = input.loss as { rate: number; level: LossLevel }
  const fixedPerUnit = payment.fixedPerUnitCents
  const perTransaction = input.perTransactionPerUnitCents ?? 0

  const reasons: Reason[] = []
  const currentMargin = marginAt(current)

  if (rawMinimum === null || rawTarget === null) {
    const result = insufficient(input, [unreachable ?? 'A meta não é alcançável pela fórmula'], margins)
    return { ...result, status: 'review', confidence: 'low', structure, currentMargin, unitContributionCents: unitProfit(current), reasons: [] }
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
  // Backed by an invoice: the real origin when the registry says it, else the purchase seen in the window.
  const invoiceBacked = input.costOrigin ? input.costOrigin.source === 'invoice' : input.costFromPurchase
  points += invoiceBacked && (input.costAgeDays ?? Infinity) <= params.data.costMaxAgeDays / 2 ? 2 : 1
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

  // What the margin would be at the current price with the previous cost, so a cost rise is shown as a loss of margin.
  const previousCost = input.previousCostCents
  const marginAtPreviousCost =
    previousCost && previousCost > 0 ? (current * (1 - variableShare) - (previousCost / (1 - loss.rate) + fixedPerUnit + perTransaction)) / current : null

  const operating = input.operating ?? null
  const validationNotes: string[] = []
  if (!operating) validationNotes.push('Classificação das despesas indisponível: o cálculo não foi validado')
  else if (!operating.complete) {
    validationNotes.push(
      `Cálculo incompleto: ${money(operating.unclassifiedCents)} em despesas sem classificação (${pct(operating.unclassifiedShare)} da receita de vendas das lojas, ${operating.scope}, ${operating.months.join(', ')}): ${operating.unclassified.map(account => `${account.code} ${account.label}`).join('; ')}`,
    )
  }
  if (operating?.perTransactionAssumption) validationNotes.push(operating.perTransactionAssumption)
  const allocationShare = operating ? operating.perVisitShare + operating.fixedShare : null
  const resultAfterAllocation: ResultAfterAllocation | null =
    operating && allocationShare !== null
      ? {
          centsPerUnit: unitProfit(current) - current * allocationShare,
          margin: marginAt(current) - allocationShare,
          criterion: `Contribuição menos deslocamento por visita e custos fixos (${pct(allocationShare)} da receita de vendas das lojas, ${operating.scope}, ${operating.months.join(', ')}) aplicados ao preço; é uma estimativa que depende deste critério, não o lucro líquido`,
        }
      : null

  // The old economic margin at the same price, and each reason the new one differs: nothing is hidden in "other".
  let reconciliation: Reconciliation | null = null
  if (operating) {
    const oldMargin = marginAt(current) - (operating.legacyShare - (input.operatingShare as number)) + perTransaction / current
    const lines = operating.shifts.map(shift => ({ label: shift.label, points: shift.share }))
    const perTransactionPoints = operating.perTransactionLegacyShare - perTransaction / current
    if (Math.abs(perTransactionPoints) > 1e-12) lines.push({ label: PER_TRANSACTION_SHIFT_LABEL, points: perTransactionPoints })
    const newMargin = marginAt(current)
    reconciliation = { oldMargin, newMargin, lines, unexplainedPoints: newMargin - oldMargin - lines.reduce((sum, line) => sum + line.points, 0) }
  }

  // The same diagnosis at the cost of the last received purchase, when it is not the cost the period used.
  const lastPurchase = input.lastPurchaseCost ?? null
  let atLastPurchaseCost: AtCost | null = null
  if (lastPurchase && lastPurchase.costCents > 0 && (lastPurchase.costCents !== cost || lastPurchase.effectiveFrom !== input.costOrigin?.effectiveFrom)) {
    const redone = solveStructure(
      { costCents: lastPurchase.costCents, taxRateBps: params.taxRateBps as number, payment, loss, operatingShare: input.operatingShare as number, perTransactionPerUnitCents: perTransaction },
      margins,
    )
    atLastPurchaseCost = {
      basis: 'received_purchase',
      costCents: lastPurchase.costCents,
      effectiveFrom: lastPurchase.effectiveFrom,
      targetPriceCents: redone.rawTarget === null ? null : shapePrice(redone.rawTarget, params),
      marginAtCurrentPrice: redone.marginAt(current),
    }
  }

  return {
    ...identity(input),
    atLastPurchaseCost,
    unitContributionCents: unitProfit(current),
    estimatedResultAfterAllocation: resultAfterAllocation,
    validated: operating !== null && operating.complete,
    validationNotes,
    reconciliation,
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
    marginAtPreviousCost,
    marginChangeFromCost: marginAtPreviousCost === null ? null : currentMargin - marginAtPreviousCost,
    monthlyUnits: input.monthlyUnits,
    monthlyRevenueCents: input.monthlyRevenueCents ?? null,
    monthlyMarginCents: input.monthlyUnits * unitProfit(current),
    impactCentsPerMonth: impact,
    impactLabel: 'Impacto potencial estimado',
    recommendedMargin: shown === null ? null : marginAt(shown),
    reasons,
    insufficientReasons: [],
    engineVersion: ENGINE_VERSION,
  }
}

import { marginsFor } from './pricing.parameters'
import { shapePrice, solveStructure, type CostStructure, type PriceInput } from './price'
import { ENGINE_VERSION, type Confidence } from './pricing.types'
import { categoryLabel } from './categories'

export const NEW_PRODUCT_LABEL = 'Produto novo — sem histórico de vendas'
const FEW_SALES_LABEL = 'Produto com poucas vendas'

export interface DataUsed {
  code: 'cost' | 'category' | 'tax' | 'payment' | 'loss' | 'operating' | 'margin' | 'rounding'
  label: string
  value: string
  /** Where the number comes from, so it is never read as more certain than it is. */
  origin: string
}

export interface NewProductInput extends Omit<PriceInput, 'currentPriceCents' | 'previousCostCents' | 'volumeDroppedAfterPriceChange' | 'costOrigin'> {
  /** Where the cost came from, in words ("Nota fiscal 13021", "Cadastro"), and whether that invoice is already received. */
  costLabel: string
  costNotReceived: boolean
  /** A price the operator typed in a draft: the answer carries the margin the engine's structure gives at it. */
  typedPriceCents?: number | null
}

export interface NewProductSuggestion {
  sku: string
  name: string | null
  /** "Produto novo — sem histórico de vendas" (or "Produto com poucas vendas" when it already sold a little). */
  label: string
  status: 'suggested' | 'insufficient_data'
  /** Never above `low`: there is no sales history to confirm the price, whatever else is known. */
  confidence: Exclude<Confidence, 'high' | 'medium'>
  minimumPriceCents: number | null
  /** The price that reaches the target margin, shaped by the same rounding as the pricing screen. */
  suggestedPriceCents: number | null
  suggestedMargin: number | null
  /** The cost per sold unit the suggestion was built on (centavos). */
  unitCostCents: number | null
  /** The suggestion is an initial one: there is no sales history behind it, whatever the label says. */
  initial: true
  /** The margin at the price the operator typed, from the same structure; null when none was typed or the structure is missing. */
  typedPrice: { priceCents: number; margin: number } | null
  targetMargin: number
  minimumMargin: number
  structure: CostStructure | null
  dataUsed: DataUsed[]
  reasons: string[]
  insufficientReasons: string[]
  engineVersion: string
}

const pct = (value: number) => `${(value * 100).toFixed(1).replace('.', ',')}%`
const money = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`

/**
 * A price suggestion for a product with no price and (usually) no sales: the SAME cost structure as the recommendation of a product that
 * sells (`solveStructure`) at the target margin, with the cost from the invoice. It has no formula of its own and it never writes a price.
 * Without sales it can only be `low` confidence, and it says which data it used.
 */
export function suggestNewProduct(input: NewProductInput): NewProductSuggestion {
  const { params } = input
  const margins = marginsFor(params, input.category ?? null)
  const label = input.monthlyUnits > 0 ? FEW_SALES_LABEL : NEW_PRODUCT_LABEL
  const base = { sku: input.sku, name: input.name ?? null, label, initial: true as const, unitCostCents: input.costCents ?? null, typedPrice: null, targetMargin: margins.target, minimumMargin: margins.minimum, engineVersion: ENGINE_VERSION }

  const missing: string[] = []
  if (input.costCents === null || input.costCents <= 0) missing.push('Sem custo: informe o custo da nota')
  if (params.taxRateBps === null) missing.push('Alíquota de imposto não configurada')
  if (!input.payment) missing.push('Sem vendas na rede para calcular o custo de pagamento')
  if (!input.loss) missing.push('Sem histórico de perda para a categoria')
  if (input.operatingShare === null) missing.push('Rateio operacional indisponível')
  if (missing.length > 0) {
    return { ...base, status: 'insufficient_data', confidence: 'low', minimumPriceCents: null, suggestedPriceCents: null, suggestedMargin: null, structure: null, dataUsed: [], reasons: [], insufficientReasons: missing }
  }

  const payment = input.payment as NonNullable<typeof input.payment>
  const loss = input.loss as NonNullable<typeof input.loss>
  const solved = solveStructure({ costCents: input.costCents as number, taxRateBps: params.taxRateBps as number, payment, loss, operatingShare: input.operatingShare as number }, margins)
  if (solved.rawTarget === null || solved.rawMinimum === null) {
    return { ...base, status: 'insufficient_data', confidence: 'low', minimumPriceCents: null, suggestedPriceCents: null, suggestedMargin: null, structure: solved.structure, dataUsed: [], reasons: [], insufficientReasons: ['A estrutura de custos consome toda a margem: nenhum preço atinge a meta'] }
  }

  const suggested = shapePrice(solved.rawTarget, params)
  const reasons = [
    input.monthlyUnits > 0 ? 'Poucas vendas: a sugestão se apoia só na estrutura de custos' : 'Sem vendas: a sugestão se apoia só na estrutura de custos, não em demanda observada',
    `Preço que atinge a margem alvo de ${pct(margins.target)} depois de imposto, taxas de pagamento, perda e rateio`,
  ]
  if (input.costNotReceived) reasons.push('O custo vem de uma nota ainda não recebida; ele só passa a valer no recebimento')

  const dataUsed: DataUsed[] = [
    { code: 'cost', label: 'Custo da unidade', value: money(input.costCents as number), origin: input.costLabel },
    { code: 'category', label: 'Categoria', value: categoryLabel(input.category, input.categoryName), origin: 'Cadastro do produto' },
    { code: 'tax', label: 'Imposto', value: pct(solved.structure.taxRate), origin: 'Parâmetro de precificação' },
    { code: 'payment', label: 'Taxas de pagamento', value: `${pct(payment.rate)}${payment.fixedPerUnitCents > 0 ? ` + ${money(Math.round(payment.fixedPerUnitCents))} por unidade` : ''}`, origin: 'Taxas cadastradas ponderadas pelo mix de vendas da rede' },
    { code: 'loss', label: 'Perda', value: pct(loss.rate), origin: `Histórico de ${loss.level === 'category' ? 'a categoria' : loss.level === 'store' ? 'a loja' : 'a rede'} (sem histórico do produto)` },
    { code: 'operating', label: 'Rateio operacional', value: pct(input.operatingShare as number), origin: 'DRE (apenas para análise de preço)' },
    { code: 'margin', label: 'Margem alvo / mínima', value: `${pct(margins.target)} / ${pct(margins.minimum)}`, origin: margins.fromCategory ? 'Parâmetro da categoria' : 'Parâmetro de precificação' },
    { code: 'rounding', label: 'Arredondamento', value: params.psychological.enabled ? `degrau de ${money(params.rounding.stepCents)}, final ,${String(params.psychological.endingCents).padStart(2, '0')}` : `degrau de ${money(params.rounding.stepCents)}`, origin: 'Parâmetro de precificação' },
  ]

  return {
    ...base,
    status: 'suggested',
    confidence: 'low',
    minimumPriceCents: shapePrice(solved.rawMinimum, params),
    suggestedPriceCents: suggested,
    suggestedMargin: solved.marginAt(suggested),
    typedPrice: input.typedPriceCents && input.typedPriceCents > 0 ? { priceCents: input.typedPriceCents, margin: solved.marginAt(input.typedPriceCents) } : null,
    structure: solved.structure,
    dataUsed,
    reasons,
    insufficientReasons: [],
  }
}

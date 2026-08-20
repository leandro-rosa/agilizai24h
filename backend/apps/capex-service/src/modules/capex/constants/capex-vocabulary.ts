/** Vocabulário de investimento. */

/** As 25 linhas de item da aba INVESTIMENTO, mais `other`. */
export const ITEM_CATEGORIES = [
  'fridge',
  'freezer',
  'wrap',
  'baskets',
  'freight',
  'barcode_reader',
  'card_terminal',
  'decor',
  'wobbler',
  'shelf_strip',
  'display',
  'furniture',
  'led',
  'sign',
  'phrase',
  'initial_stock',
  'shelf_plate',
  'camera',
  'tv',
  'system_activation',
  'other',
] as const
export type ItemCategory = (typeof ITEM_CATEGORIES)[number]

export const INVESTMENT_KINDS = ['fixed', 'initial', 'operating_expense'] as const
export type InvestmentKind = (typeof INVESTMENT_KINDS)[number]

export const CONTRIBUTION_KINDS = [
  'equipment',
  'furniture',
  'store_comms',
  'stock',
  'system',
  'loan',
  'other',
] as const
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number]

/**
 * Quanto um item custou de fato: o parcelado quando houve parcelamento, o à
 * vista quando não. A planilha guarda os dois e a diferença entre eles é o
 * custo do crédito — somar o à vista quando a compra foi parcelada
 * subestima o investimento.
 */
export function itemCostCents(item: { cash_amount_cents: number; financed_amount_cents: number }): number {
  return item.financed_amount_cents > 0 ? item.financed_amount_cents : item.cash_amount_cents
}

/**
 * Payback em meses. **MÉTRICA DERIVADA**, nunca fato: depende de um lucro
 * mensal que hoje é premissa digitada no painel.
 *
 * `null` quando o lucro não é positivo — nenhum número de meses paga um
 * investimento com lucro zero ou negativo, e devolver 0 ali diria que já se
 * pagou, que é o contrário da verdade.
 */
export function paybackMonths(totalInvestedCents: number, monthlyProfitCents: number): number | null {
  if (monthlyProfitCents <= 0) return null
  if (totalInvestedCents <= 0) return 0

  return Math.round((totalInvestedCents / monthlyProfitCents) * 100) / 100
}

/** Vocabulário do plano de contas. Fechado, porque o DRE depende dele. */

export const STATEMENTS = ['pnl', 'cashflow'] as const
export type Statement = (typeof STATEMENTS)[number]

/** Seções do DRE, na ordem em que a planilha as apresenta. */
export const PNL_SECTIONS = [
  'gross_revenue',
  'deductions',
  'cogs',
  'variable_expenses',
  'fixed_expenses',
  'financial_expenses',
] as const

/** Seções do fluxo de caixa. */
export const CASHFLOW_SECTIONS = ['receipts', 'opex', 'loans', 'capex'] as const

export const SECTIONS = [...PNL_SECTIONS, ...CASHFLOW_SECTIONS] as const
export type Section = (typeof SECTIONS)[number]

export const ORIGINS = ['manual', 'treasury', 'sales', 'finance', 'billing'] as const
export type Origin = (typeof ORIGINS)[number]

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * O DRE é uma cascata: cada total consome o anterior. Escrito uma vez aqui
 * para as duas pontas (apuração e tela) não divergirem sobre o que "margem
 * de contribuição" quer dizer.
 *
 * Todos os argumentos são valores POSITIVOS de despesa; a subtração é
 * responsabilidade desta função. Passar despesa já negativa dobra o sinal, e
 * essa é a classe de erro que a planilha comete ao arrastar fórmula.
 */
export interface PnlInput {
  gross_revenue_cents: number
  deductions_cents: number
  cogs_cents: number
  variable_expenses_cents: number
  fixed_expenses_cents: number
  financial_expenses_cents: number
}

export interface PnlTotals {
  net_revenue_cents: number
  gross_profit_cents: number
  contribution_margin_cents: number
  ebitda_cents: number
  operating_profit_cents: number
  break_even_cents: number
  safety_margin_bps: number
}

export function computePnl(input: PnlInput): PnlTotals {
  const net_revenue_cents = input.gross_revenue_cents - input.deductions_cents
  const gross_profit_cents = net_revenue_cents - input.cogs_cents
  const contribution_margin_cents = gross_profit_cents - input.variable_expenses_cents
  const ebitda_cents = contribution_margin_cents - input.fixed_expenses_cents
  const operating_profit_cents = ebitda_cents - input.financial_expenses_cents

  // Break-even: quanto de receita líquida cobre exatamente a despesa fixa,
  // dada a margem de contribuição percentual do próprio período.
  //
  // Sem receita, ou com margem de contribuição não-positiva, não existe ponto
  // de equilíbrio — nenhum volume de venda cobre o fixo. Devolver 0 ali seria
  // dizer "já está no equilíbrio", que é o contrário da verdade; devolver -1
  // marca "indefinido" para a tela mostrar "—" em vez de uma cifra falsa.
  const marginRatio = net_revenue_cents > 0 ? contribution_margin_cents / net_revenue_cents : 0
  const break_even_cents = marginRatio > 0 ? Math.round(input.fixed_expenses_cents / marginRatio) : -1

  // Margem de segurança: quanto a receita pode cair antes de bater o
  // break-even. Negativa quando a operação está abaixo dele — e precisa
  // aparecer negativa, não zerada.
  const safety_margin_bps =
    break_even_cents > 0 && net_revenue_cents > 0
      ? Math.round(((net_revenue_cents - break_even_cents) / net_revenue_cents) * 10_000)
      : 0

  return {
    net_revenue_cents,
    gross_profit_cents,
    contribution_margin_cents,
    ebitda_cents,
    operating_profit_cents,
    break_even_cents,
    safety_margin_bps,
  }
}

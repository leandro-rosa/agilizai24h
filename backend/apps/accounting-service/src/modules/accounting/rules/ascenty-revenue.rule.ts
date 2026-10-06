export interface AscentyRuleConfig {
  /** Toda entrada múltipla disto é mensalidade (um contrato = 70000 centavos). */
  mensalidade_unit_cents: number
  /** Toda outra entrada múltipla disto é fatura de serviço: coffee break + frutas. */
  service_unit_cents: number
  /** Quanto de cada `service_unit_cents` é coffee break; o resto é frutas. */
  coffee_unit_cents: number
}

export interface AscentyRevenueSplit {
  mensalidade_cents: number
  coffee_cents: number
  frutas_cents: number
  /** Entradas que não batem em nenhuma regra — nunca viram receita sozinhas. */
  unclassified_cents: number
}

/**
 * Classifica as entradas da Ascenty de um mês em receita de mensalidade, coffee
 * break e frutas. Regra derivada dos extratos de jul–set/2026 (o operador
 * confirmou os totais de set/2026): 700/1400 são mensalidade; todo o resto é
 * múltiplo de R$ 68, e cada R$ 68 = R$ 20 de coffee break + R$ 48 de frutas.
 * É uma REGRA do operador, não um fato contábil — por isso é parametrizada e
 * o que não encaixa fica em `unclassified_cents` em vez de ser chutado.
 */
export function splitAscentyRevenue(amountsCents: number[], cfg: AscentyRuleConfig): AscentyRevenueSplit {
  const split: AscentyRevenueSplit = { mensalidade_cents: 0, coffee_cents: 0, frutas_cents: 0, unclassified_cents: 0 }

  for (const amount of amountsCents) {
    if (amount % cfg.mensalidade_unit_cents === 0) {
      split.mensalidade_cents += amount
    } else if (amount % cfg.service_unit_cents === 0) {
      const units = amount / cfg.service_unit_cents
      split.coffee_cents += units * cfg.coffee_unit_cents
      split.frutas_cents += units * (cfg.service_unit_cents - cfg.coffee_unit_cents)
    } else {
      split.unclassified_cents += amount
    }
  }

  return split
}

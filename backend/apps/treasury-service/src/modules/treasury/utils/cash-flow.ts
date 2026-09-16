/** One row as read from `bank_transaction`, already scoped to the query window. */
export interface CashFlowTransaction {
  occurred_on: string // "YYYY-MM-DD"
  direction: 'inflow' | 'outflow'
  amount_cents: number
  category: string
}

export interface DailyCashFlow {
  date: string
  inflow_cents: number
  outflow_cents: number
  /** Running balance through the end of this day — always includes every row, transfers included. */
  balance_cents: number
}

export interface CashFlowSummary {
  from: string
  to: string
  /** `null` = "Todas as contas" (consolidated). */
  account_id: number | null
  opening_balance_cents: number
  inflow_cents: number
  outflow_cents: number
  closing_balance_cents: number
  daily: DailyCashFlow[]
}

/**
 * Transferência entre as próprias contas Agiliz.AI — a categoria que sai de
 * Entradas/Saídas no consolidado (cada transferência grava uma perna de
 * saída numa conta e uma perna de entrada em outra, então soma zero ali),
 * mas NUNCA sai do saldo (é caixa real se movendo).
 */
export const INTERNAL_TRANSFER_CATEGORY = 'Movimentação entre contas'

/**
 * Agrega lançamentos já filtrados por `occurred_on` em [from, to] num
 * resumo de fluxo de caixa. Dois acumuladores independentes por dia — o
 * saldo soma TODA linha (é o saldo de caixa de verdade), Entradas/Saídas
 * somam tudo MENOS `INTERNAL_TRANSFER_CATEGORY` quando `accountId` é nulo
 * (consolidado). Com uma conta específica, nada é excluído — do ponto de
 * vista de uma conta isolada uma transferência é caixa real saindo/entrando
 * dela, e excluir quebraria "saldo inicial + entradas − saídas = saldo
 * final" para essa visão.
 *
 * A identidade acima fecha exatamente sempre que as duas pernas de cada
 * transferência caem dentro de [from, to] — o caso comum. Se uma
 * transferência for cortada pela borda do range (uma perna dentro, a outra
 * fora), o saldo ainda reflete a perna real que aconteceu na janela, mas
 * essa perna some do lado Entradas/Saídas — a diferença é o residual, não
 * escondido, não corrigido à força (ver spec, "Gap conhecido").
 */
export function computeCashFlow(
  from: string,
  to: string,
  accountId: number | null,
  openingBalanceCents: number,
  transactions: CashFlowTransaction[],
): CashFlowSummary {
  const excludeTransfers = accountId === null

  const byDate = new Map<string, { balanceDelta: number; flowInflow: number; flowOutflow: number }>()
  for (const t of transactions) {
    const bucket = byDate.get(t.occurred_on) ?? { balanceDelta: 0, flowInflow: 0, flowOutflow: 0 }
    const signed = t.direction === 'inflow' ? t.amount_cents : -t.amount_cents
    bucket.balanceDelta += signed

    const countsAsFlow = !excludeTransfers || t.category !== INTERNAL_TRANSFER_CATEGORY
    if (countsAsFlow) {
      if (t.direction === 'inflow') bucket.flowInflow += t.amount_cents
      else bucket.flowOutflow += t.amount_cents
    }
    byDate.set(t.occurred_on, bucket)
  }

  let runningBalance = openingBalanceCents
  const daily: DailyCashFlow[] = [...byDate.keys()].sort().map(date => {
    const bucket = byDate.get(date)!
    runningBalance += bucket.balanceDelta
    return { date, inflow_cents: bucket.flowInflow, outflow_cents: bucket.flowOutflow, balance_cents: runningBalance }
  })

  return {
    from,
    to,
    account_id: accountId,
    opening_balance_cents: openingBalanceCents,
    inflow_cents: daily.reduce((sum, d) => sum + d.inflow_cents, 0),
    outflow_cents: daily.reduce((sum, d) => sum + d.outflow_cents, 0),
    closing_balance_cents: runningBalance,
    daily,
  }
}

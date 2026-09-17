import { computeCashFlow, INTERNAL_TRANSFER_CATEGORIES, type CashFlowTransaction } from './cash-flow'

// Named references into the Set, in the same order `cash-flow.ts` declares
// it — keeps the tests below from repeating the literal category strings.
const [TRANSFER_CATEGORY, FATURA_CATEGORY] = [...INTERNAL_TRANSFER_CATEGORIES]

function tx(partial: Partial<CashFlowTransaction> & Pick<CashFlowTransaction, 'occurred_on' | 'direction' | 'amount_cents'>): CashFlowTransaction {
  return { category: 'Estoque', ...partial }
}

describe('computeCashFlow', () => {
  it('returns the opening balance unchanged with no transactions in range', () => {
    const result = computeCashFlow('2026-06-01', '2026-06-30', null, 10_000, [])

    expect(result).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
      account_id: null,
      opening_balance_cents: 10_000,
      inflow_cents: 0,
      outflow_cents: 0,
      closing_balance_cents: 10_000,
      daily: [],
    })
  })

  it('accumulates a running daily balance across multiple days, sorted ascending', () => {
    const result = computeCashFlow('2026-06-01', '2026-06-30', null, 0, [
      tx({ occurred_on: '2026-06-02', direction: 'inflow', amount_cents: 500 }),
      tx({ occurred_on: '2026-06-01', direction: 'outflow', amount_cents: 200 }),
      tx({ occurred_on: '2026-06-02', direction: 'outflow', amount_cents: 100 }),
    ])

    expect(result.daily).toEqual([
      { date: '2026-06-01', inflow_cents: 0, outflow_cents: 200, balance_cents: -200 },
      { date: '2026-06-02', inflow_cents: 500, outflow_cents: 100, balance_cents: 200 },
    ])
    expect(result.inflow_cents).toBe(500)
    expect(result.outflow_cents).toBe(300)
    expect(result.closing_balance_cents).toBe(200)
  })

  it('excludes "Movimentação entre contas" from entradas/saídas in consolidated view, but keeps it in the balance', () => {
    // Same real transfer recorded on both accounts' statements: an outflow
    // leg on account 1 and the paired inflow leg on account 2, same day,
    // same amount — this is what makes the exclusion net to zero.
    const result = computeCashFlow('2026-06-01', '2026-06-30', null, 0, [
      tx({ occurred_on: '2026-06-05', direction: 'outflow', amount_cents: 1_000, category: TRANSFER_CATEGORY }),
      tx({ occurred_on: '2026-06-05', direction: 'inflow', amount_cents: 1_000, category: TRANSFER_CATEGORY }),
      tx({ occurred_on: '2026-06-05', direction: 'inflow', amount_cents: 300, category: 'Vendas' }),
    ])

    expect(result.inflow_cents).toBe(300) // the transfer inflow leg is excluded
    expect(result.outflow_cents).toBe(0) // the transfer outflow leg is excluded
    // Balance reflects the true cash position: both transfer legs + the sale.
    expect(result.closing_balance_cents).toBe(1_000 - 1_000 + 300)
    // Formula closes exactly because both transfer legs landed in the window.
    expect(result.closing_balance_cents).toBe(result.opening_balance_cents + result.inflow_cents - result.outflow_cents)
  })

  it('excludes "Pagamento de fatura" from entradas/saídas in consolidated view, but keeps it in the balance', () => {
    // Same two-legged structure as "Movimentação entre contas": the bank-side
    // outflow leg (money leaving the checking account) and the card-side
    // inflow leg (money arriving on the card side), same day, same amount —
    // the card spend itself was already counted at purchase time, so both
    // legs of the invoice payment must net to zero in the consolidated view.
    const result = computeCashFlow('2026-06-01', '2026-06-30', null, 0, [
      tx({ occurred_on: '2026-06-05', direction: 'outflow', amount_cents: 1_000, category: FATURA_CATEGORY }),
      tx({ occurred_on: '2026-06-05', direction: 'inflow', amount_cents: 1_000, category: FATURA_CATEGORY }),
      tx({ occurred_on: '2026-06-05', direction: 'inflow', amount_cents: 300, category: 'Vendas' }),
    ])

    expect(result.inflow_cents).toBe(300) // the fatura inflow leg is excluded
    expect(result.outflow_cents).toBe(0) // the fatura outflow leg is excluded
    // Balance reflects the true cash position: both fatura legs + the sale.
    expect(result.closing_balance_cents).toBe(1_000 - 1_000 + 300)
    // Formula closes exactly because both fatura legs landed in the window.
    expect(result.closing_balance_cents).toBe(result.opening_balance_cents + result.inflow_cents - result.outflow_cents)
  })

  it('does NOT exclude "Movimentação entre contas" when a specific account is selected', () => {
    const result = computeCashFlow('2026-06-01', '2026-06-30', 17, 0, [
      tx({ occurred_on: '2026-06-05', direction: 'outflow', amount_cents: 1_000, category: TRANSFER_CATEGORY }),
    ])

    // From this single account's perspective the transfer is real cash
    // leaving — excluding it here would break the closing-balance identity.
    expect(result.outflow_cents).toBe(1_000)
    expect(result.closing_balance_cents).toBe(-1_000)
    expect(result.closing_balance_cents).toBe(result.opening_balance_cents + result.inflow_cents - result.outflow_cents)
  })

  it('counts non-transfer `movement` categories (empréstimo, sócio, CDB) as real entradas/saídas', () => {
    const result = computeCashFlow('2026-06-01', '2026-06-30', null, 0, [
      tx({ occurred_on: '2026-06-10', direction: 'inflow', amount_cents: 5_000, category: 'Financiamento/empréstimo' }),
    ])

    expect(result.inflow_cents).toBe(5_000)
    expect(result.closing_balance_cents).toBe(5_000)
  })

  it('documents the known edge case: a transfer pair split across the window boundary does not close exactly', () => {
    // Only the outflow leg of this transfer falls inside [from, to] — its
    // paired inflow leg landed the next day, past `to`. The balance still
    // reflects the real leg that happened in-window; the KPI cards drop it
    // (transfer exclusion) — so the identity has a residual, by design. See
    // "Gap conhecido" in the spec.
    const result = computeCashFlow('2026-06-01', '2026-06-30', null, 0, [
      tx({ occurred_on: '2026-06-30', direction: 'outflow', amount_cents: 1_000, category: TRANSFER_CATEGORY }),
    ])

    expect(result.inflow_cents).toBe(0)
    expect(result.outflow_cents).toBe(0) // excluded from the KPI view
    expect(result.closing_balance_cents).toBe(-1_000) // but the cash really left
    expect(result.closing_balance_cents).not.toBe(result.opening_balance_cents + result.inflow_cents - result.outflow_cents)
  })
})

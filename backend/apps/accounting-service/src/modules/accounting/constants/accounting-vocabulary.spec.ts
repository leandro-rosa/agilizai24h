import { computePnl } from './accounting-vocabulary'

describe('computePnl', () => {
  // Numeros na ordem de grandeza do julho/2026 real da planilha.
  const base = {
    gross_revenue_cents: 132_604_90,
    deductions_cents: 8_000_00,
    cogs_cents: 49_219_02,
    variable_expenses_cents: 12_000_00,
    fixed_expenses_cents: 20_000_00,
    financial_expenses_cents: 3_000_00,
  }

  it('cascades each total into the next', () => {
    const t = computePnl(base)

    expect(t.net_revenue_cents).toBe(base.gross_revenue_cents - base.deductions_cents)
    expect(t.gross_profit_cents).toBe(t.net_revenue_cents - base.cogs_cents)
    expect(t.contribution_margin_cents).toBe(t.gross_profit_cents - base.variable_expenses_cents)
    expect(t.ebitda_cents).toBe(t.contribution_margin_cents - base.fixed_expenses_cents)
    expect(t.operating_profit_cents).toBe(t.ebitda_cents - base.financial_expenses_cents)
  })

  it('treats every expense argument as positive', () => {
    // Passar despesa ja negativa dobraria o sinal — a classe de erro que a
    // planilha comete ao arrastar formula. Aqui despesa maior derruba o
    // resultado, nunca o aumenta.
    const maior = computePnl({ ...base, fixed_expenses_cents: base.fixed_expenses_cents * 2 })
    const menor = computePnl(base)

    expect(maior.ebitda_cents).toBeLessThan(menor.ebitda_cents)
  })

  it('marks break-even undefined when contribution margin is not positive', () => {
    const t = computePnl({ ...base, variable_expenses_cents: 999_999_00 })

    // -1 e "indefinido", nao "ja esta no equilibrio": nenhum volume de venda
    // cobre o fixo quando a margem de contribuicao e negativa.
    expect(t.contribution_margin_cents).toBeLessThan(0)
    expect(t.break_even_cents).toBe(-1)
    expect(t.safety_margin_bps).toBe(0)
  })

  it('marks break-even undefined when there is no revenue', () => {
    const t = computePnl({ ...base, gross_revenue_cents: 0, deductions_cents: 0 })

    expect(t.break_even_cents).toBe(-1)
  })

  it('reports a negative safety margin when revenue is below break-even', () => {
    // A margem de contribuicao desta base e ~50,9% da receita liquida, entao
    // o break-even so passa a receita com fixo acima de ~R$ 63,4 mil.
    const t = computePnl({ ...base, fixed_expenses_cents: 80_000_00 })

    expect(t.break_even_cents).toBeGreaterThan(t.net_revenue_cents)
    expect(t.safety_margin_bps).toBeLessThan(0)
  })

  it('reports safety margin in basis points', () => {
    const t = computePnl(base)

    // Entre 0 e 100% para uma operacao saudavel, expresso em bps.
    expect(t.safety_margin_bps).toBeGreaterThan(0)
    expect(t.safety_margin_bps).toBeLessThanOrEqual(10_000)
  })
})

import { parseC6Invoice } from './c6-invoice.parser'

describe('parseC6Invoice', () => {
  it('a compra has no structural hint — resolved by mapping rules', () => {
    const result = parseC6Invoice([{ pageNumber: 1, lines: ['05 jul POSTO IPIRANGA CENTRO 150,00'] }], '2026-07')

    expect(result.rows[0].structuralHint).toBeUndefined()
    expect(result.rows[0].direction).toBe('outflow')
    expect(result.rows[0].occurredOn).toBe('2026-07-05')
  })

  it('a payment line is a movement and counts as the inflow side of the fatura', () => {
    const result = parseC6Invoice([{ pageNumber: 1, lines: ['10 jul Inclusao de Pagamento 5.000,00'] }], '2026-07')

    expect(result.rows[0]).toMatchObject({
      direction: 'inflow',
      structuralHint: { kind: 'movement', category: 'Pagamento de fatura' },
    })
  })

  it('a QR code payment line is also a movement', () => {
    const result = parseC6Invoice([{ pageNumber: 1, lines: ['11 jul Pagamento Fatura QR CODE 3.000,00'] }], '2026-07')
    expect(result.rows[0].structuralHint?.kind).toBe('movement')
  })

  it('a refinanciamento line is a financial expense, not a new compra, and drops the trailing Juros/IOF detail', () => {
    const result = parseC6Invoice(
      [{ pageNumber: 1, lines: ['28 jan Refinanciamento Fatura - Parcela 4/6 1.372,66\tJuros: R$ 1.427,90 | IOF: R$ 1.691,12'] }],
      '2026-06',
    )

    expect(result.rows[0]).toMatchObject({
      direction: 'outflow',
      amountCents: 137266,
      counterpartyRaw: 'Refinanciamento Fatura - Parcela 4/6',
      installmentIndex: 4,
      installmentTotal: 6,
      structuralHint: { kind: 'expense', category: 'Financeiro/Tributos' },
    })
  })

  it('an ordinary installment purchase carries the installment fields with no structural hint', () => {
    const result = parseC6Invoice([{ pageNumber: 1, lines: ['13 jul LOJA MOVEIS Parcela 3/10 200,00'] }], '2026-07')

    expect(result.rows[0]).toMatchObject({ installmentIndex: 3, installmentTotal: 10 })
    expect(result.rows[0].structuralHint).toBeUndefined()
  })

  it('a cartão adicional line is analysed the same as the cartão principal', () => {
    const result = parseC6Invoice(
      [{ pageNumber: 1, lines: ['14 jul C6 Business Final 1234 - BARBARA O FERNANDES POSTO SHELL 80,00'] }],
      '2026-07',
    )

    expect(result.rows[0].counterpartyRaw).toContain('POSTO SHELL')
    expect(result.rows[0].direction).toBe('outflow')
  })

  it('rejects a line with a date but no readable amount', () => {
    const result = parseC6Invoice([{ pageNumber: 1, lines: ['15 jul linha sem valor nenhum'] }], '2026-07')
    expect(result.rows).toEqual([])
    expect(result.rejections).toHaveLength(1)
  })

  // Regression: no purchase line states a year anywhere in the real document
  // — the uploader-stated period is the only source of truth, with a
  // rollover rule for a month well after the period's own (a fatura closing
  // in January can carry a late-December purchase).
  it('rolls back to the previous year when the month is well after the period month', () => {
    const result = parseC6Invoice([{ pageNumber: 1, lines: ['28 dez COMPRA FIM DE ANO 500,00'] }], '2026-01')

    expect(result.rows[0].occurredOn).toBe('2025-12-28')
  })

  it('ignores a card-level subtotal line, which never starts with a date', () => {
    const result = parseC6Invoice(
      [{ pageNumber: 1, lines: ['C6 Business Virtual Final 0910 - BARBARA O F LTDA Subtotal deste cartão R$ 3.754,75\tCartão Virtual'] }],
      '2026-06',
    )

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([])
  })
})

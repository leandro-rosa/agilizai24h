import { parsePagSeguroInvoice } from './pagseguro-invoice.parser'

describe('parsePagSeguroInvoice', () => {
  it('parses a compra line — description, bare amount, date at the end', () => {
    const result = parsePagSeguroInvoice([{ pageNumber: 2, lines: ['DISTRIBUIDORA MARSIL - Parc.2/2 863,27\t18/11/2025'] }])

    expect(result.rejections).toEqual([])
    expect(result.rows[0]).toEqual({
      occurredOn: '2025-11-18',
      amountCents: 86327,
      direction: 'outflow',
      counterpartyRaw: 'DISTRIBUIDORA MARSIL - Parc.2/2',
      sourceRef: 'p2L1',
      installmentIndex: 2,
      installmentTotal: 2,
    })
  })

  it('a "Pagamento de Fatura" line is a movement, the inflow side of the fatura', () => {
    const result = parsePagSeguroInvoice([{ pageNumber: 2, lines: ['Pagamento de Fatura em 01/12 3.093,61\t01/12/2025'] }])

    expect(result.rows[0]).toMatchObject({
      direction: 'inflow',
      structuralHint: { kind: 'movement', category: 'Pagamento de fatura' },
    })
  })

  it('a plain compra with no installment marker has no installment fields', () => {
    const result = parsePagSeguroInvoice([{ pageNumber: 2, lines: ['AKKI ATACADISTA 69,52\t01/12/2025'] }])

    expect(result.rows[0].installmentIndex).toBeUndefined()
    expect(result.rows[0].structuralHint).toBeUndefined()
  })

  it('ignores the repeated table header, which never ends in a date', () => {
    const result = parsePagSeguroInvoice([{ pageNumber: 2, lines: ['Data Transação Valor R$'] }])

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([])
  })

  it('ignores the "Total despesas / débitos" footer, which never ends in a date', () => {
    const result = parsePagSeguroInvoice([{ pageNumber: 4, lines: ['Total despesas / débitos R$ 11.041,53'] }])

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([])
  })
})

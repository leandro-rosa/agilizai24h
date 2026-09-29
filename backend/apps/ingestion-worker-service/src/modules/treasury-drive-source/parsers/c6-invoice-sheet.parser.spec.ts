import { parseC6InvoiceSheet } from './c6-invoice-sheet.parser'

const HEADER = ['Data de Compra', 'Nome no Cartão', 'Final do Cartão', 'Categoria', 'Descrição', 'Parcela', 'Valor (em US$)', 'Cotação (em R$)', 'Valor (em R$)', 'Tipo', 'detalhe']

describe('parseC6InvoiceSheet', () => {
  it('parses a normal purchase row (Parcela as plain text)', () => {
    const rows = [HEADER, ['2026-08-09T00:00:00.000Z', 'BARBARA O F LTDA', 910, 'Empresa para empresa', 'SERV. NUVEM INTELBRAS', 'Única', 0, 0, 159.9, 'Operacional', 'camera']]
    const result = parseC6InvoiceSheet(rows)
    expect(result.rejections).toEqual([])
    expect(result.rows[0]).toEqual({
      occurredOn: '2026-08-09',
      amountCents: 15990,
      direction: 'outflow',
      counterpartyRaw: 'SERV. NUVEM INTELBRAS',
      sourceRef: 'row2',
    })
  })

  it('parses a negative Valor (em R$) as an inflow — a credit/payment line on the invoice', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', 'BARBARA O F LTDA', 910, '-', 'Inclusao de Pagamento    ', 'Única', 0, 0, -11978.85, 'cartão de crédito', 'cartão']]
    const result = parseC6InvoiceSheet(rows)
    expect(result.rows[0].direction).toBe('inflow')
    expect(result.rows[0].amountCents).toBe(1197885)
  })

  it('handles a Parcela cell holding a serialized date instead of plain text, without crashing or dropping the row', () => {
    const rows = [HEADER, ['2026-04-01T00:00:00.000Z', 'BARBARA O F LTDA', 910, 'Serviços de telecomunicações', 'PAGSEGUROINTERNET', '2026-06-05T00:00:00.000Z', 0, 0, 163.4, 'investimento', 'maquininha']]
    const result = parseC6InvoiceSheet(rows)
    expect(result.rejections).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].amountCents).toBe(16340)
  })

  it('handles a Descrição cell that is a hyperlink object instead of a plain string (real shape seen in the file)', () => {
    const rows = [HEADER, ['2026-07-29T00:00:00.000Z', 'BARBARA O F LTDA', 910, 'Entretenimento', { text: 'APPLE.COM/BILL', hyperlink: 'http://apple.com/BILL' }, 'Única', 0, 0, 20.5, 'Cloud apple', '']]
    const result = parseC6InvoiceSheet(rows)
    expect(result.rejections).toEqual([])
    expect(result.rows[0].counterpartyRaw).toBe('APPLE.COM/BILL')
  })

  it('never sets structuralHint from Tipo/detalhe', () => {
    const rows = [HEADER, ['2026-08-09T00:00:00.000Z', 'BARBARA O F LTDA', 910, 'Empresa para empresa', 'SERV. NUVEM INTELBRAS', 'Única', 0, 0, 159.9, 'Operacional', 'camera']]
    const result = parseC6InvoiceSheet(rows)
    expect(result.rows[0].structuralHint).toBeUndefined()
  })

  // Structural-hint research finding (task 7): the PDF `c6-invoice.parser.ts` already treats
  // "Inclusão de Pagamento" as a bank-printed structural fact (kind: 'movement', category:
  // 'Pagamento de fatura') — confirmed as the canonical example in
  // `treasury-ingestion-contracts`'s own doc comment for `structuralHint`. The invoice SHEET's
  // real `Descrição` column carries the identical text (this exact fixture, from the brief's
  // own "negative Valor" test above) — `Categoria` does NOT carry it (real sample values are
  // merchant-category labels like "Empresa para empresa"/"Serviços de telecomunicações", never
  // "Inclusao de Pagamento"). Dropping this would regress the Drive-sourced path relative to
  // the already-shipped PDF path for the identical real transaction.
  it('sets structuralHint from Descrição when it contains the bank-printed "Inclusao de Pagamento" pattern the PDF invoice parser already recognizes', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', 'BARBARA O F LTDA', 910, '-', 'Inclusao de Pagamento    ', 'Única', 0, 0, -11978.85, 'cartão de crédito', 'cartão']]
    const result = parseC6InvoiceSheet(rows)
    expect(result.rows[0].structuralHint).toEqual({ kind: 'movement', category: 'Pagamento de fatura' })
  })

  it('sets structuralHint from Descrição when it contains the bank-printed "Refinanciamento Fatura" pattern (same shared pattern list as the PDF parser)', () => {
    const rows = [HEADER, ['2026-01-28T00:00:00.000Z', 'BARBARA O F LTDA', 910, '-', 'Refinanciamento Fatura - Parcela 4/6', 'Única', 0, 0, 1372.66, 'investimento', 'financiamento']]
    const result = parseC6InvoiceSheet(rows)
    expect(result.rows[0].structuralHint).toEqual({ kind: 'expense', category: 'Financeiro/Tributos' })
  })

  it('does not set structuralHint from Categoria — real Categoria values are merchant-category labels, not a bank-assigned pagamento/refinanciamento signal', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', 'BARBARA O F LTDA', 910, 'Serviços de telecomunicações', 'PAGSEGUROINTERNET', 'Única', 0, 0, 163.4, 'investimento', 'maquininha']]
    const result = parseC6InvoiceSheet(rows)
    expect(result.rows[0].structuralHint).toBeUndefined()
  })
})

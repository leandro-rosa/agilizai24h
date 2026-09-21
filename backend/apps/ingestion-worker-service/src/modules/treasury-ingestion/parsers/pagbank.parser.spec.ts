import { parsePagBankStatement } from './pagbank.parser'

describe('parsePagBankStatement', () => {
  it('strips "Pix enviado" so counterpartyRaw is the bare favorecido a mapping rule can match', () => {
    const result = parsePagBankStatement([{ pageNumber: 1, lines: ['15/07/2026 Pix enviado AMBEV -R$1.234,56'] }])

    expect(result.rows[0].counterpartyRaw).toBe('AMBEV')
  })

  it('strips "QR Code Pix enviado" the same way', () => {
    const result = parsePagBankStatement([
      { pageNumber: 1, lines: ['16/07/2026 QR Code Pix enviado POSTO IPIRANGA -R$150,00'] },
    ])

    expect(result.rows[0].counterpartyRaw).toBe('POSTO IPIRANGA')
  })

  it('still recognises the fatura line as a structural movement, verb prefix or not', () => {
    const result = parsePagBankStatement([
      { pageNumber: 1, lines: ['17/07/2026 Cartão PagBank - Pagamento de Fatura -R$3.500,00'] },
    ])

    expect(result.rows[0].structuralHint).toEqual({ kind: 'movement', category: 'Pagamento de fatura' })
  })

  // Regression: real text (jan-ago/2026 backfill) — these three recurring
  // self-fees always split their amount onto a continuation line with no
  // date of its own, so before the continuation-join fix they never became
  // a row at all (silently rejected, 24 times across 8 real months).
  it('classifies the "Cobrança PagBank Saúde" self-fee as an expense, amount on the continuation line', () => {
    const result = parsePagBankStatement([
      {
        pageNumber: 1,
        lines: ['10/01/2026 Cobrança PagBank Saúde - Para: PAGSEGURO INTERNET INSTITUICAO DE', 'PAGAMENTO -R$ 24,90'],
      },
    ])

    expect(result.rejections).toEqual([])
    expect(result.rows[0].amountCents).toBe(2490)
    expect(result.rows[0].direction).toBe('outflow')
    expect(result.rows[0].structuralHint).toEqual({ kind: 'expense', category: 'Financeiro/Tributos' })
  })

  it('classifies "Cobrança Seguro Cartão Protegido" and "Mensalidade Seguro Conta" the same way', () => {
    const result = parsePagBankStatement([
      {
        pageNumber: 1,
        lines: [
          '17/01/2026 Cobrança Seguro Cartão Protegido - Para: PAGSEGURO INTERNET INSTITUICAO DE',
          'PAGAMENTO -R$ 7,90',
          '17/01/2026 Mensalidade Seguro Conta - Para: PAGSEGURO INTERNET INSTITUICAO DE',
          'PAGAMENTO -R$ 6,90',
        ],
      },
    ])

    expect(result.rejections).toEqual([])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].amountCents).toBe(790)
    expect(result.rows[0].structuralHint).toEqual({ kind: 'expense', category: 'Financeiro/Tributos' })
    expect(result.rows[1].amountCents).toBe(690)
    expect(result.rows[1].structuralHint).toEqual({ kind: 'expense', category: 'Financeiro/Tributos' })
  })

  // Regression: jan-fev/2026 label these same three self-fees with an
  // undifferentiated "Pagamento com QR Code" wording (real text measured
  // against the jan-ago/2026 backfill) — 6 of the 24 real rejections used
  // this variant, missed by the first pass at this fix because it only
  // covered the mar-ago wording.
  it('classifies the jan-fev "Pagamento com QR Code - Para: PAGSEGURO..." wording as an expense too', () => {
    const result = parsePagBankStatement([
      {
        pageNumber: 1,
        lines: ['10/01/2026 Pagamento com QR Code - Para: PAGSEGURO INTERNET INSTITUICAO DE', 'PAGAMENTO -R$ 24,90'],
      },
    ])

    expect(result.rejections).toEqual([])
    expect(result.rows[0].amountCents).toBe(2490)
    expect(result.rows[0].direction).toBe('outflow')
    expect(result.rows[0].structuralHint).toEqual({ kind: 'expense', category: 'Financeiro/Tributos' })
  })

  it('does not misclassify a genuine third-party QR-code payment under the self-fee pattern', () => {
    const result = parsePagBankStatement([
      { pageNumber: 1, lines: ['12/01/2026 Pagamento com QR Code - Para: Lalamove Tecnologia Brasil Ltda -R$45,00'] },
    ])

    expect(result.rejections).toEqual([])
    expect(result.rows[0].structuralHint).toBeUndefined()
  })
})

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
})

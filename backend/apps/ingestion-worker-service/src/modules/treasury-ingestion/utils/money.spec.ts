import { findBareMoneyInText, findMoneyInText, parseBrlAmountToCents } from './money'

describe('parseBrlAmountToCents', () => {
  it('parses a plain amount', () => {
    expect(parseBrlAmountToCents('150,00')).toBe(15000)
  })

  it('parses a thousands-separated amount', () => {
    expect(parseBrlAmountToCents('1.234,56')).toBe(123456)
  })

  it('parses a multi-thousands amount', () => {
    expect(parseBrlAmountToCents('45.678,90')).toBe(4567890)
  })

  it('rejects a value with no decimal comma', () => {
    expect(parseBrlAmountToCents('150')).toBeNull()
  })

  it('rejects garbage', () => {
    expect(parseBrlAmountToCents('not a number')).toBeNull()
  })
})

describe('findMoneyInText', () => {
  it('finds a positive amount', () => {
    expect(findMoneyInText('17/07/2026 Pix recebido AGILIZ.AI LTDA R$2.000,00')).toEqual({
      amountCents: 200000,
      negative: false,
    })
  })

  // The defining case: finance's own bug log names this exact shape as the
  // one the original PagBank extraction missed — no space between the sign
  // and the currency mark.
  it('finds a negative amount with the sign concatenated to R$, no space', () => {
    expect(findMoneyInText('15/07/2026 Pix enviado ASSAI ATACADISTA LJ49 -R$1.234,56')).toEqual({
      amountCents: 123456,
      negative: true,
    })
  })

  it('finds a negative amount with a space between the sign and R$', () => {
    expect(findMoneyInText('16/07/2026 Cartão PagBank - Pagamento de Fatura -R$ 500,00')).toEqual({
      amountCents: 50000,
      negative: true,
    })
  })

  it('does not truncate the decimal part of a thousands-separated amount', () => {
    // Regression: an earlier version of the regex treated the thousands-group
    // and the decimal-comma group as alternatives instead of grouping the
    // integer-part alternatives together, so "1.234,56" matched only "1.234"
    // and the ",56" was silently dropped.
    const result = findMoneyInText('R$45.678,90')
    expect(result?.amountCents).toBe(4567890)
  })

  it('returns null when there is no R$ amount in the text', () => {
    expect(findMoneyInText('linha sem valor nenhum')).toBeNull()
  })

  // Regression: a real PagSeguro fatura summary box shows "R$-7.110,28" —
  // sign AFTER the currency mark, the opposite order from the historical bug.
  it('finds a negative amount with the sign after R$', () => {
    expect(findMoneyInText('Saldo Residual R$-7.110,28')).toEqual({
      amountCents: 711028,
      negative: true,
    })
  })
})

describe('findBareMoneyInText', () => {
  // Regression: Itaú's real extrato carries essentially no R$ marker at all
  // ("R$" appears twice in the whole document, never on a transaction line).
  it('finds a negative amount with no R$ marker', () => {
    expect(findBareMoneyInText('03/08/2026 SISPAG FORNECEDORES -670,00')).toEqual({
      amountCents: 67000,
      negative: true,
    })
  })

  // The mandatory ",XX" suffix is what keeps this from matching the CNPJ
  // instead of the real amount that follows it on the same line.
  it('finds a positive amount with no sign, skipping a CNPJ earlier on the line', () => {
    expect(findBareMoneyInText('60.819.321/0001-44 2.411,00')).toEqual({
      amountCents: 241100,
      negative: false,
    })
  })

  it('returns null when there is no bare amount in the text', () => {
    expect(findBareMoneyInText('BARBARA OLIVEIRA FERNANDES LTDA')).toBeNull()
  })
})

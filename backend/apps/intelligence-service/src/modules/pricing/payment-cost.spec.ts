import { effectiveVoucherFee, methodOf, paymentCost, type FeeRate, type MixRow } from './payment-cost'

const rate = (acquirer: string, method: FeeRate['method'], rateBps: number): FeeRate => ({ acquirer, method, rateBps })
const row = (method: string | null, acquirer: string | null, cardBrand: string | null, receiptLines: number, amountCents: number): MixRow => ({ method, acquirer, cardBrand, receiptLines, amountCents })

const VOUCHERS = [rate('Alelo', 'voucher', 300), rate('Ticket', 'voucher', 350), rate('Pluxee', 'voucher', 400), rate('VR Benefícios', 'voucher', 450)]

describe('methodOf', () => {
  it.each([
    ['PIX', 'pix'],
    ['Débito', 'debit'],
    ['Cartão de Crédito', 'credit'],
    ['Voucher', 'voucher'],
    ['Vale Refeição', 'voucher'],
    ['VR', 'voucher'],
    [null, null],
    ['Dinheiro', null],
  ])('%s -> %s', (raw, expected) => expect(methodOf(raw as string | null)).toBe(expected))
})

describe('effectiveVoucherFee', () => {
  it('weights the brands by their share of the voucher sales', () => {
    const fee = effectiveVoucherFee(VOUCHERS, [row('Voucher', 'x', 'Alelo', 60, 6000), row('Voucher', 'x', 'Ticket', 40, 4000)], 50)

    expect(fee.basis).toBe('sales_weighted')
    expect(fee.rateBps).toBeCloseTo(0.6 * 300 + 0.4 * 350, 6)
  })

  it('falls back to the simple average when the volume is too small', () => {
    const fee = effectiveVoucherFee(VOUCHERS, [row('Voucher', 'x', 'Alelo', 3, 300)], 50)

    expect(fee.basis).toBe('simple_average')
    expect(fee.rateBps).toBeCloseTo((300 + 350 + 400 + 450) / 4, 6)
  })

  it('reports a brand with sales and no rate instead of pricing it at 0%', () => {
    const fee = effectiveVoucherFee(VOUCHERS, [row('Voucher', 'x', 'Alelo', 60, 6000), row('Voucher', 'x', 'Sodexo', 60, 6000)], 50)

    expect(fee.missingRateBrands).toEqual(['Sodexo'])
    expect(fee.rateBps).toBeCloseTo(300, 6)
  })

  it('has no rate when no voucher brand is registered', () => {
    expect(effectiveVoucherFee([rate('PagBank', 'pix', 69)], [row('Voucher', 'x', 'Alelo', 60, 6000)], 50)).toMatchObject({ rateBps: null, basis: 'none' })
  })
})

describe('Sodexo is Pluxee', () => {
  const rates = [rate('Pluxee', 'voucher', 690), rate('Ticket', 'voucher', 599), rate('Alelo', 'voucher', 690)]
  const aliases = { sodexo: 'pluxee' }

  it('prices SODEXO sales with the Pluxee rate instead of reporting a missing brand', () => {
    const fee = effectiveVoucherFee(rates, [row('Voucher', 'PagSeguro', 'SODEXO', 100, 5000), row('Voucher', 'PagSeguro', 'TICKET', 100, 5000)], 50, aliases)

    expect(fee.missingRateBrands).toEqual([])
    expect(fee.basis).toBe('sales_weighted')
    expect(fee.rateBps).toBeCloseTo(0.5 * 690 + 0.5 * 599, 6)
  })

  it('without the alias the Sodexo sales are reported missing', () => {
    expect(effectiveVoucherFee(rates, [row('Voucher', 'PagSeguro', 'SODEXO', 100, 5000), row('Voucher', 'PagSeguro', 'TICKET', 100, 5000)], 50).missingRateBrands).toEqual(['SODEXO'])
  })
})

describe('PagSeguro is PagBank, and a second plan is averaged and said so', () => {
  const aliases = { pagseguro: 'pagbank' }
  const mix = [row('Débito', 'PagSeguro', 'MAESTRO', 100, 5000)]

  it('prices PagSeguro sales with the PagBank rate when there is one plan', () => {
    const cost = paymentCost([rate('PagBank', 'debit', 139)], mix, 50, aliases)!

    expect(cost.rate).toBeCloseTo(0.0139, 8)
    expect(cost.notes).toEqual([])
  })

  it('keeps the matched plan and says that another registered plan is not used', () => {
    const cost = paymentCost([rate('PagBank', 'debit', 139), rate('PagBank plano 2', 'debit', 189)], mix, 50, aliases)!

    expect(cost.rate).toBeCloseTo(0.0139, 8)
    expect(cost.notes.join(' ')).toContain('nenhuma venda usa')
    expect(cost.notes.join(' ')).toContain('PagBank plano 2 1,89%')
  })

  it('averages the plans when the sale names an acquirer none of them match', () => {
    const cost = paymentCost([rate('PlanoA', 'debit', 139), rate('PlanoB', 'debit', 189)], [row('Débito', 'Outra', 'MAESTRO', 100, 5000)], 50, aliases)!

    expect(cost.rate).toBeCloseTo(0.0164, 8)
    expect(cost.notes.join(' ')).toContain('média simples de 2 planos')
  })
})

describe('fixed fee per sale', () => {
  const rates = [rate('PagBank', 'pix', 69), { ...rate('Ticket', 'voucher', 599), fixedCents: 89 }, rate('Alelo', 'voucher', 690)]

  it('weights the voucher fixed fee by brand and spreads it over every sale', () => {
    // 100 Ticket lines + 100 Alelo lines, equal revenue => voucher fixed = 44.5; voucher is 200 of 400 lines => 22.25 per sold line
    const mix = [row('Voucher', 'PagSeguro', 'TICKET', 100, 5000), row('Voucher', 'PagSeguro', 'ALELO', 100, 5000), row('Pix', 'PagBank', null, 200, 10_000)]
    const cost = paymentCost(rates, mix, 50)!

    expect(cost.fixedPerUnitCents).toBeCloseTo(22.25, 6)
  })

  it('is zero when no fee has a fixed part', () => {
    expect(paymentCost([rate('PagBank', 'pix', 69)], [row('Pix', 'PagBank', null, 10, 1000)], 50)!.fixedPerUnitCents).toBe(0)
  })
})

describe('paymentCost', () => {
  const RATES = [rate('PagBank', 'pix', 69), rate('PagBank', 'debit', 139), rate('PagBank', 'credit', 297), ...VOUCHERS]

  it('weights each method by its share of the sales', () => {
    const mix = [
      row('Voucher', 'x', 'Alelo', 100, 2200),
      row('Pix', 'PagBank', null, 100, 4000),
      row('Débito', 'PagBank', null, 100, 2000),
      row('Crédito', 'PagBank', null, 100, 1800),
    ]
    const cost = paymentCost(RATES, mix, 50)!
    const expectedBps = (2200 * 300 + 4000 * 69 + 2000 * 139 + 1800 * 297) / 10_000

    expect(cost.rate).toBeCloseTo(expectedBps / 10_000, 8)
    expect(cost.voucherShare).toBeCloseTo(0.22, 8)
    expect(cost.complete).toBe(true)
  })

  it('does not apply the voucher fee to every sale', () => {
    const cost = paymentCost(RATES, [row('Voucher', 'x', 'Alelo', 100, 2200), row('Pix', 'PagBank', null, 100, 7800)], 50)!

    expect(cost.rate).toBeLessThan(0.03)
  })

  it('flags sales it cannot price and stays incomplete', () => {
    const cost = paymentCost([rate('PagBank', 'pix', 69)], [row('Pix', 'PagBank', null, 10, 5000), row('Crédito', 'PagBank', null, 10, 5000)], 50)!

    expect(cost.complete).toBe(false)
    expect(cost.unresolvedShare).toBeCloseTo(0.5, 8)
    expect(cost.rate).toBeCloseTo(0.0069, 8)
  })

  it('keeps two acquirers of one method on their own rates', () => {
    const rates = [rate('PagBank', 'credit', 297), rate('PagBank condicao 2', 'credit', 350)]
    const cost = paymentCost(rates, [row('Crédito', 'PagBank', null, 1, 5000), row('Crédito', 'PagBank condição 2', null, 1, 5000)], 50)!

    expect(cost.rate).toBeCloseTo((297 + 350) / 2 / 10_000, 8)
  })

  it('is null with no sales', () => {
    expect(paymentCost(RATES, [], 50)).toBeNull()
  })
})

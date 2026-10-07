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

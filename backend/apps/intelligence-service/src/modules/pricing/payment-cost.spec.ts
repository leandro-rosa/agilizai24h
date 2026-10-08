import { distributeTicketCosts, ticketsFromLines } from './transaction-cost'
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

  it('does not report a sale with no brand as a brand missing a rate, and still prices it', () => {
    const fee = effectiveVoucherFee(VOUCHERS, [row('Voucher', 'PagSeguro', 'Alelo', 60, 6000), row('Voucher', 'PagSeguro', null, 1, 7)], 50)

    expect(fee.missingRateBrands).toEqual([])
    expect(fee.rateBps).toBeCloseTo(300, 6)
    const cost = paymentCost([rate('PagBank', 'pix', 69), ...VOUCHERS], [row('Voucher', 'PagSeguro', 'Alelo', 60, 6000), row('Voucher', 'PagSeguro', null, 1, 7), row('Pix', 'PagBank', null, 100, 4000)], 50)!
    expect(cost.complete).toBe(true)
    expect(cost.notes.join(' ')).not.toContain('sem taxa')
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

  it('averages the registered plans when the sales cannot tell them apart, and says so', () => {
    const cost = paymentCost([rate('PagBank', 'debit', 139), rate('PagBank plano 2', 'debit', 189)], mix, 50, aliases)!

    expect(cost.rate).toBeCloseTo(0.0164, 8)
    expect(cost.notes.join(' ')).toContain('média simples de 2 planos')
  })

  it('keeps an exact match when the sales do tell several acquirers apart', () => {
    const two = [row('Débito', 'PagSeguro', 'MAESTRO', 100, 5000), row('Débito', 'Cielo', 'MAESTRO', 100, 5000)]
    const cost = paymentCost([rate('PagBank', 'debit', 139), rate('Cielo', 'debit', 189)], two, 50, aliases)!

    expect(cost.rate).toBeCloseTo(0.0164, 8) // each half of the sales at its own acquirer's rate: (139 + 189) / 2
    expect(cost.notes).toEqual([])
  })
})

describe('fixed fee per sale — per ticket, spread over the UNITS sold', () => {
  const rates = [rate('PagBank', 'pix', 69), { ...rate('Ticket', 'voucher', 599), fixedCents: 89 }, rate('Alelo', 'voucher', 690)]
  /** A mix row with the units, the tickets and how many lines had no coupon. */
  const counted = (method: string, acquirer: string, brand: string | null, lines: number, cents: number, units: number, tickets: number, withoutCoupon: number): MixRow => ({ ...row(method, acquirer, brand, lines, cents), units, tickets, linesWithoutCoupon: withoutCoupon })

  it('weights the voucher fixed fee by brand, charges it per TICKET and divides by the units, not by the lines', () => {
    // 100 Ticket + 100 Alelo voucher tickets of equal revenue => voucher fixed = 44,5 per ticket. Voucher tickets: 200, carrying 300 units; Pix: 200 tickets, 200 units.
    const mix = [counted('Voucher', 'PagSeguro', 'TICKET', 100, 5000, 150, 100, 100), counted('Voucher', 'PagSeguro', 'ALELO', 100, 5000, 150, 100, 100), counted('Pix', 'PagBank', null, 200, 10_000, 200, 200, 200)]
    const cost = paymentCost(rates, mix, 50)!

    // Estimated total = 44,5 x 200 tickets = 8.900 cents; over 500 units = 17,8 per unit (the old figure, 22,25, divided by lines and called it per unit).
    expect(cost.fixed?.estimatedTotalCents).toBeCloseTo(8900, 6)
    expect(cost.fixedPerUnitCents).toBeCloseTo(17.8, 6)
    expect(cost.fixedPerUnitCents).not.toBeCloseTo(22.25, 2)
    expect(cost.fixed).toMatchObject({ tickets: 400, units: 500, lines: 400, basis: 'line_approximation' })
  })

  it('a line of several units spreads the fee of its ticket: more units per ticket, a smaller fee per unit', () => {
    const single = paymentCost(rates, [counted('Voucher', 'x', 'TICKET', 10, 1000, 10, 10, 10)], 1)!
    const triple = paymentCost(rates, [counted('Voucher', 'x', 'TICKET', 10, 1000, 30, 10, 10)], 1)!

    expect(single.fixedPerUnitCents).toBeCloseTo(89, 6)
    expect(triple.fixedPerUnitCents).toBeCloseTo(89 / 3, 6)
  })

  it('with coupons the tickets are observed: several lines of one purchase pay ONE fee', () => {
    // 10 voucher lines forming 4 coupons, 14 units: 4 x 89 = 356 over 14 units; as 10 lines it would have been 890.
    const cost = paymentCost(rates, [counted('Voucher', 'x', 'TICKET', 10, 1000, 14, 4, 0)], 1)!

    expect(cost.fixed).toMatchObject({ estimatedTotalCents: 356, tickets: 4, linesWithoutCoupon: 0, basis: 'coupon' })
    expect(cost.fixedPerUnitCents).toBeCloseTo(356 / 14, 6)
    expect(cost.notes.join(' ')).not.toContain('aproximação')
  })

  it('without a coupon each line is a ticket and the result says it is an estimate, not an observed charge', () => {
    const cost = paymentCost(rates, [counted('Voucher', 'x', 'TICKET', 10, 1000, 14, 10, 10)], 1)!

    expect(cost.fixed?.basis).toBe('line_approximation')
    expect(cost.fixed?.note).toContain('Total estimado')
    expect(cost.fixed?.note).toContain('não é o valor cobrado pelas adquirentes')
    expect(cost.fixed?.note).toContain('Nenhuma linha traz o cupom')
    expect(cost.notes.join(' ')).toContain('aproximação')
  })

  it('a mix of coupon and no-coupon lines is flagged as mixed with the counts', () => {
    const cost = paymentCost(rates, [counted('Voucher', 'x', 'TICKET', 10, 1000, 14, 7, 4)], 1)!

    expect(cost.fixed).toMatchObject({ basis: 'mixed', linesWithoutCoupon: 4, tickets: 7 })
    expect(cost.fixed?.note).toContain('4 de 10 linhas sem cupom')
  })

  it('an older sales service without units cannot distribute the fee: nothing is invented and the cost is incomplete', () => {
    const cost = paymentCost(rates, [row('Voucher', 'x', 'TICKET', 10, 1000)], 1)!

    expect(cost.fixedPerUnitCents).toBe(0)
    expect(cost.fixed?.basis).toBe('unknown_units')
    expect(cost.complete).toBe(false)
  })

  it('agrees with the exact distribution of the same tickets: the aggregate per unit times the units is the sum of the distributed fees', () => {
    // Six voucher lines without coupon (units 3,1,2,5,1,1) and two Pix lines that carry no fee.
    const lines = [3, 1, 2, 5, 1, 1].map((quantity, index) => ({ sku: `S${index}`, quantity, coupon: null }))
    const { tickets } = ticketsFromLines(lines)
    const exact = distributeTicketCosts(tickets.map(ticket => ({ ...ticket, costCents: 89 })))
    const units = lines.reduce((sum, line) => sum + line.quantity, 0)
    const cost = paymentCost(rates, [counted('Voucher', 'x', 'TICKET', 6, 6000, units, 6, 6)], 1)!

    expect(exact.distributedCents).toBe(6 * 89)
    expect(cost.fixedPerUnitCents * units).toBeCloseTo(exact.distributedCents, 8)
  })

  it('is zero when no fee has a fixed part', () => {
    expect(paymentCost([rate('PagBank', 'pix', 69)], [counted('Pix', 'PagBank', null, 10, 1000, 12, 10, 10)], 50)!.fixedPerUnitCents).toBe(0)
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

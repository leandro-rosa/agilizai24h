import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateFeeDto } from '../dto/treasury.dto'
import { ratesInForce, type FeeRow } from './fee-rates'

const fee = (acquirer: string, payment_method: string, rate_bps: number, effective_from: string): FeeRow => ({
  acquirer,
  payment_method,
  rate_bps,
  effective_from: new Date(`${effective_from}T00:00:00.000Z`),
})

describe('ratesInForce', () => {
  const fees = [
    fee('PagBank', 'credit', 297, '2026-01-01'),
    fee('PagBank', 'credit', 350, '2026-08-01'),
    fee('PagBank', 'debit', 139, '2026-01-01'),
  ]

  it('reads a past month with the rate that was in force then', () => {
    const credit = ratesInForce(fees, '2026-06-15').rates.find((rate) => rate.payment_method === 'credit')

    expect(credit?.rate_bps).toBe(297)
  })

  it('switches to the newer rate from its effective date', () => {
    const credit = ratesInForce(fees, '2026-08-01').rates.find((rate) => rate.payment_method === 'credit')

    expect(credit?.rate_bps).toBe(350)
  })

  it('ignores rates that start after the date', () => {
    expect(ratesInForce(fees, '2025-12-31').rates).toEqual([])
  })

  it('reports methods with no registered rate instead of returning 0', () => {
    const result = ratesInForce(fees, '2026-06-15')

    expect(result.methods_without_rate).toEqual(['pix', 'voucher'])
    expect(result.rates.some((rate) => rate.rate_bps === 0)).toBe(false)
  })

  it('keeps voucher brands as separate acquirers', () => {
    const result = ratesInForce([fee('Alelo', 'voucher', 300, '2026-01-01'), fee('Ticket', 'voucher', 350, '2026-01-01')], '2026-02-01')

    expect(result.rates.map((rate) => rate.acquirer)).toEqual(['Alelo', 'Ticket'])
    expect(result.methods_without_rate).not.toContain('voucher')
  })
})

describe('fixed fee per sale', () => {
  it('returns the fixed fee with the rate and defaults it to zero', () => {
    const result = ratesInForce([{ ...fee('Ticket', 'voucher', 599, '2026-01-01'), fixed_cents: 89 }, fee('Alelo', 'voucher', 690, '2026-01-01')], '2026-02-01')

    expect(result.rates.find(rate => rate.acquirer === 'Ticket')?.fixed_cents).toBe(89)
    expect(result.rates.find(rate => rate.acquirer === 'Alelo')?.fixed_cents).toBe(0)
  })
})

describe('CreateFeeDto validation', () => {
  const valid = { acquirer: 'PagBank', payment_method: 'debit', rate_bps: 139, effective_from: '2026-01-01' }
  const errorsFor = (input: object) => validate(plainToInstance(CreateFeeDto, input))

  it('accepts a valid fee', async () => {
    expect(await errorsFor(valid)).toHaveLength(0)
  })

  it.each([
    ['negative rate', { rate_bps: -1 }],
    ['rate above 100%', { rate_bps: 10_001 }],
    ['non-integer rate', { rate_bps: 1.5 }],
    ['unknown method', { payment_method: 'boleto' }],
    ['empty acquirer', { acquirer: '   ' }],
    ['negative fixed fee', { fixed_cents: -1 }],
    ['non-integer fixed fee', { fixed_cents: 0.5 }],
  ])('rejects %s', async (_name, override) => {
    expect((await errorsFor({ ...valid, ...override })).length).toBeGreaterThan(0)
  })
})

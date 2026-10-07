import { SalesTransactionsService } from './sales-transactions.service'

describe('SalesTransactionsService.paymentMix', () => {
  const make = (grouped: any[], periodsWithData: string[]) => {
    const groupBy = jest.fn(async () => grouped)
    const findMany = jest.fn(async () => periodsWithData.map(period => ({ period })))
    const service = new SalesTransactionsService({ salesTransaction: { groupBy, findMany } } as never)

    return { service, groupBy }
  }

  const row = (method: string, acquirer: string | null, card_brand: string | null, lines: number, cents: number) => ({
    method,
    acquirer,
    card_brand,
    _count: { _all: lines },
    _sum: { amount_paid_cents: cents },
  })

  it('returns revenue by method, acquirer and brand with the total', async () => {
    const { service } = make([row('voucher', 'Alelo', 'Alelo', 60, 6000), row('voucher', 'Ticket', 'Ticket', 40, 4000), row('pix', null, null, 100, 10000)], ['2026-08'])
    const result = await service.paymentMix('2026-08', '2026-08')

    expect(result.rows).toHaveLength(3)
    expect(result.total_amount_paid_cents).toBe(20000)
    expect(result.store_id).toBeNull()
    expect(result.periods_without_transactions).toEqual([])
  })

  it('counts only OK receipts of the window months, scoped to the store when given', async () => {
    const { service, groupBy } = make([], [])
    await service.paymentMix('2026-07', '2026-09', 7)

    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { store_id: 7, result: 'OK', period: { in: ['2026-07', '2026-08', '2026-09'] } } }))
  })

  it('reports months with no receipts as unknown, not as an empty mix of zeros', async () => {
    const { service } = make([row('pix', null, null, 10, 1000)], ['2026-08'])
    const result = await service.paymentMix('2026-07', '2026-08')

    expect(result.periods_without_transactions).toEqual(['2026-07'])
  })

  it('returns no rows and every month unknown when nothing was ingested', async () => {
    const { service } = make([], [])
    const result = await service.paymentMix('2026-08', '2026-09')

    expect(result.rows).toEqual([])
    expect(result.total_amount_paid_cents).toBe(0)
    expect(result.periods_without_transactions).toEqual(['2026-08', '2026-09'])
  })
})

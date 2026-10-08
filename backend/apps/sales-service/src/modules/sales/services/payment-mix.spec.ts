import { SalesTransactionsService } from './sales-transactions.service'

describe('SalesTransactionsService.paymentMix', () => {
  const make = (grouped: unknown[], periodsWithData: string[]) => {
    const queryRaw = jest.fn(async (..._args: unknown[]) => grouped)
    const findMany = jest.fn(async () => periodsWithData.map(period => ({ period })))
    const service = new SalesTransactionsService({ $queryRaw: queryRaw, salesTransaction: { findMany } } as never)

    return { service, queryRaw }
  }

  /** Counts come back from Postgres as bigint. */
  const row = (method: string, acquirer: string | null, card_brand: string | null, lines: number, cents: number, units = lines, coupons = 0, withoutCoupon = lines) => ({
    method,
    acquirer,
    card_brand,
    lines: BigInt(lines),
    units: BigInt(units),
    amount: BigInt(cents),
    coupons: BigInt(coupons),
    lines_without_coupon: BigInt(withoutCoupon),
  })

  it('returns revenue by method, acquirer and brand with the total', async () => {
    const { service } = make([row('voucher', 'Alelo', 'Alelo', 60, 6000), row('voucher', 'Ticket', 'Ticket', 40, 4000), row('pix', null, null, 100, 10000)], ['2026-08'])
    const result = await service.paymentMix('2026-08', '2026-08')

    expect(result.rows).toHaveLength(3)
    expect(result.total_amount_paid_cents).toBe(20000)
    expect(result.store_id).toBeNull()
    expect(result.periods_without_transactions).toEqual([])
  })

  it('reports units and tickets: a line of three units is three units, and a line without a coupon is a ticket of its own', async () => {
    // 10 lines carrying 25 units: 6 lines share 2 coupons, 4 lines have no coupon.
    const { service } = make([row('pix', null, null, 10, 5000, 25, 2, 4)], ['2026-08'])
    const [only] = (await service.paymentMix('2026-08', '2026-08')).rows

    expect(only).toMatchObject({ receipt_lines: 10, units: 25, tickets: 6, lines_without_coupon: 4, amount_paid_cents: 5000 })
  })

  it('without any coupon every line is a ticket and the rows say how many were counted that way', async () => {
    const { service } = make([row('debit', 'PagBank', null, 8, 800, 11, 0, 8)], ['2026-08'])
    const [only] = (await service.paymentMix('2026-08', '2026-08')).rows

    expect(only.tickets).toBe(8)
    expect(only.lines_without_coupon).toBe(only.receipt_lines)
  })

  it('reads only OK receipts of the window months, scoped to the store when given', async () => {
    const { service, queryRaw } = make([], [])
    await service.paymentMix('2026-07', '2026-09', 7)
    const query = queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] }

    expect(query.sql).toContain("result = 'OK'")
    expect(query.sql).toContain('store_id =')
    expect(query.values).toEqual(expect.arrayContaining(['2026-07', '2026-08', '2026-09', 7]))
  })

  it('network scope has no store filter', async () => {
    const { service, queryRaw } = make([], [])
    await service.paymentMix('2026-08', '2026-08')

    expect((queryRaw.mock.calls[0][0] as { sql: string }).sql).not.toContain('store_id =')
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

import { SalesTransactionsService } from './sales-transactions.service'

describe('SalesTransactionsService.paymentMix', () => {
  const make = (grouped: unknown[], periodsWithData: string[]) => {
    const queryRaw = jest.fn(async (..._args: unknown[]) => grouped)
    const findMany = jest.fn(async () => periodsWithData.map(period => ({ period })))
    const service = new SalesTransactionsService({ $queryRaw: queryRaw, salesTransaction: { findMany } } as never)

    return { service, queryRaw }
  }

  /** Counts come back from Postgres as bigint. */
  const row = (method: string, acquirer: string | null, card_brand: string | null, lines: number, cents: number, units = lines, ticketIds = 0, withoutTicketId = lines) => ({
    method,
    acquirer,
    card_brand,
    lines: BigInt(lines),
    units: BigInt(units),
    amount: BigInt(cents),
    ticket_ids: BigInt(ticketIds),
    lines_without_ticket_id: BigInt(withoutTicketId),
  })

  it('returns revenue by method, acquirer and brand with the total', async () => {
    const { service } = make([row('voucher', 'Alelo', 'Alelo', 60, 6000), row('voucher', 'Ticket', 'Ticket', 40, 4000), row('pix', null, null, 100, 10000)], ['2026-08'])
    const result = await service.paymentMix('2026-08', '2026-08')

    expect(result.rows).toHaveLength(3)
    expect(result.total_amount_paid_cents).toBe(20000)
    expect(result.store_id).toBeNull()
    expect(result.periods_without_transactions).toEqual([])
  })

  it('reports units and tickets: a line of three units is three units, and a line with no purchase identifier at all is counted on its own (the caller estimates it)', async () => {
    // 10 lines carrying 25 units: 6 lines share 2 purchase identifiers, 4 lines have none.
    const { service } = make([row('pix', null, null, 10, 5000, 25, 2, 4)], ['2026-08'])
    const [only] = (await service.paymentMix('2026-08', '2026-08')).rows

    expect(only).toMatchObject({ receipt_lines: 10, units: 25, tickets: 6, lines_without_ticket_id: 4, amount_paid_cents: 5000 })
  })

  it('without any identifier every line is counted once and the rows say how many were counted that way', async () => {
    const { service } = make([row('debit', 'PagBank', null, 8, 800, 11, 0, 8)], ['2026-08'])
    const [only] = (await service.paymentMix('2026-08', '2026-08')).rows

    expect(only.tickets).toBe(8)
    expect(only.lines_without_ticket_id).toBe(only.receipt_lines)
  })

  it('identifies a ticket by the coupon, else the transaction code, else the acquirer code (and counts the lines that have none)', async () => {
    const { service, queryRaw } = make([row('pix', null, null, 6, 3000, 8, 3, 0)], ['2026-08'])
    await service.paymentMix('2026-08', '2026-08')
    const sql = (queryRaw.mock.calls[0][0] as { sql?: string; strings?: string[] }).sql ?? (queryRaw.mock.calls[0][0] as { strings: string[] }).strings.join('?')

    expect(sql).toMatch(/COALESCE\(coupon, internal_code, acquirer_code\)/)
    expect(sql).toMatch(/lines_without_ticket_id/)
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


describe('SalesTransactionsService.paymentMixBySku', () => {
  it('returns the mix of each product, from OK receipts only, and lists months without receipts', async () => {
    const queryRaw = jest.fn(async (..._args: unknown[]) => [
      { sku: '100103', method: 'PIX', acquirer: null, card_brand: null, lines: BigInt(40), units: BigInt(52), amount: BigInt(61000) },
      { sku: '100103', method: 'Voucher', acquirer: 'Ticket', card_brand: 'Ticket', lines: BigInt(12), units: BigInt(12), amount: BigInt(14000) },
    ])
    const findMany = jest.fn(async () => [{ period: '2026-08' }])
    const service = new SalesTransactionsService({ $queryRaw: queryRaw, salesTransaction: { findMany } } as never)
    const result = await service.paymentMixBySku('2026-07', '2026-08')

    expect(result.rows).toEqual([
      { sku: '100103', method: 'PIX', acquirer: null, card_brand: null, receipt_lines: 40, units: 52, amount_paid_cents: 61000 },
      { sku: '100103', method: 'Voucher', acquirer: 'Ticket', card_brand: 'Ticket', receipt_lines: 12, units: 12, amount_paid_cents: 14000 },
    ])
    expect(result.periods_without_transactions).toEqual(['2026-07'])
    expect(result.store_id).toBeNull()
  })
})

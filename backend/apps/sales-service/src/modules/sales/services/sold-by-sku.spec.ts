import { monthsOfWindow, SalesTransactionsService } from './sales-transactions.service'

describe('monthsOfWindow', () => {
  it('lists every month a window of days touches', () => {
    expect(monthsOfWindow('2026-10-05', '2026-10-11')).toEqual(['2026-10'])
    expect(monthsOfWindow('2026-09-28', '2026-10-04')).toEqual(['2026-09', '2026-10'])
    expect(monthsOfWindow('2026-12-30', '2027-01-02')).toEqual(['2026-12', '2027-01'])
  })
})

describe('SalesTransactionsService.soldBySku', () => {
  const make = (state: { total: number; undated: number; transactionStores: number; recordStores: number }) => {
    const groupBy = jest.fn(async () => [{ sku: 'Q1', _sum: { quantity: 62, amount_paid_cents: 40000 } }])
    const prisma = {
      salesTransaction: {
        groupBy,
        count: jest.fn(async ({ where }: any) => (where.occurred_at === null ? state.undated : state.total)),
        findMany: jest.fn(async () => Array.from({ length: state.transactionStores }, (_, i) => ({ store_id: i }))),
      },
      salesRecord: { findMany: jest.fn(async () => Array.from({ length: state.recordStores }, (_, i) => ({ store_id: i }))) },
    }

    return { service: new SalesTransactionsService(prisma as never), groupBy }
  }

  it('sums OK receipts of the window by SKU', async () => {
    const { service, groupBy } = make({ total: 100, undated: 0, transactionStores: 20, recordStores: 20 })
    const result = await service.soldBySku('2026-10-05', '2026-10-11', ['Q1'])

    expect(result).toEqual({ from: '2026-10-05', to: '2026-10-11', rows: [{ sku: 'Q1', quantity: 62, revenue_cents: 40000 }], months_without_dated_receipts: [], stores_missing: 0 })
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ result: 'OK', sku: { in: ['Q1'] } }) }))
  })

  it('flags a month whose receipts have no timestamp or no receipts at all, so the days are unknown rather than zero', async () => {
    expect((await make({ total: 100, undated: 5, transactionStores: 20, recordStores: 20 }).service.soldBySku('2026-10-05', '2026-10-11', ['Q1'])).months_without_dated_receipts).toEqual(['2026-10'])
    expect((await make({ total: 0, undated: 0, transactionStores: 0, recordStores: 20 }).service.soldBySku('2026-10-05', '2026-10-11', ['Q1'])).months_without_dated_receipts).toEqual(['2026-10'])
  })

  it('reports stores that have monthly sales but no receipts', async () => {
    const { service } = make({ total: 100, undated: 0, transactionStores: 18, recordStores: 20 })

    expect((await service.soldBySku('2026-10-05', '2026-10-11', ['Q1'])).stores_missing).toBe(2)
  })
})

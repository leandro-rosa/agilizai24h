import { SupplyService } from './supply.service'

describe('SupplyService.findNetworkBalances', () => {
  const lines = [
    { sku: 'A', balance_after: 10, visit: { store_id: 1, ended_at: new Date('2026-10-01T10:00:00Z') } },
    { sku: 'A', balance_after: 4, visit: { store_id: 1, ended_at: new Date('2026-10-05T10:00:00Z') } },
    { sku: 'A', balance_after: 7, visit: { store_id: 2, ended_at: new Date('2026-09-20T10:00:00Z') } },
    { sku: 'B', balance_after: 0, visit: { store_id: 1, ended_at: new Date('2026-10-05T10:00:00Z') } },
  ]
  const service = new SupplyService({ supplyVisitLine: { findMany: async () => lines } } as never)

  it('sums only each store\'s LATEST balance, and exposes how old the oldest one is', async () => {
    const { rows } = await service.findNetworkBalances(['A', 'B'])

    expect(rows).toEqual([
      { sku: 'A', in_stores: 11, stores: 2, last_visit: '2026-10-05', oldest_store_visit: '2026-09-20' },
      { sku: 'B', in_stores: 0, stores: 1, last_visit: '2026-10-05', oldest_store_visit: '2026-10-05' },
    ])
  })

  it('a SKU never seen has no row (unknown, not zero)', async () => {
    expect((await service.findNetworkBalances(['ZZZ'])).rows.map(r => r.sku)).not.toContain('ZZZ')
  })
})

import { CostSyncService } from './cost-sync.service'

type Item = Record<string, any>

/** In-memory purchase_item table with just what the outbox reads and writes. */
function fake(items: Item[], purchase: Record<string, any> = {}) {
  const purchaseRow = { id: 9, supplier_id: 5, status: 'received', invoice_number: '13021', received_on: new Date('2026-10-10'), ...purchase }
  const rows = items.map((i, n) => ({ id: n + 1, purchase_id: 9, quantity: 150, received_quantity: null, pack_quantity: null, units_per_pack: null, cost_sync: null, cost_sync_attempts: 0, cost_sync_attempted_at: null, cost_alerts: [], ...i }))
  const prisma = {
    purchaseItem: {
      findMany: async ({ where }: any) => rows.filter(r => where.cost_sync.in.includes(r.cost_sync) && r.cost_sync_attempts < where.cost_sync_attempts.lt && purchaseRow.status === where.purchase.status && (!where.purchase.id || where.purchase.id === r.purchase_id)).map(r => ({ ...r, purchase: purchaseRow })),
      update: async ({ where, data }: any) => Object.assign(rows.find(r => r.id === where.id)!, data),
      updateMany: async ({ where, data }: any) => rows.filter(r => r.purchase_id === where.purchase_id && r.cost_sync === where.cost_sync).map(r => Object.assign(r, data)).length,
    },
  }

  return { prisma, rows }
}

const config = (values: Record<string, unknown> = {}) => ({ get: (key: string) => values[key] })
const make = (items: Item[], opts: { record?: jest.Mock; month?: 'closed' | 'open' | 'unknown'; config?: Record<string, unknown>; purchase?: Record<string, any> } = {}) => {
  const { prisma, rows } = fake(items, opts.purchase)
  const record = opts.record ?? jest.fn(async (_sku: string, input: any) => ({ created: true, unchanged: false, version_id: 100 + input.purchase_item_id, cost_cents: input.cost_cents, previous_cost_cents: 570 }))
  const accounting = { monthStatus: jest.fn(async () => opts.month ?? 'open') }
  const service = new CostSyncService(prisma as never, { recordInvoiceCost: record } as never, accounting as never, config(opts.config) as never)

  return { service, rows, record, accounting, prisma }
}

const pending = (over: Item = {}) => ({ sku: 'MONSTER', unit_cost_cents: 620, condition: 'paid', cost_sync: 'pending', ...over })

describe('CostSyncService', () => {
  it('a received item is sent as an invoice cost dated on the receipt, with its provenance and idempotency key', async () => {
    const { service, rows, record } = make([pending({ pack_quantity: 10, units_per_pack: 15 })])

    expect(await service.drain(9)).toEqual({ sent: 1, failed: 0 })

    expect(record).toHaveBeenCalledWith(
      'MONSTER',
      expect.objectContaining({ effective_from: '2026-10-10', cost_cents: 620, supplier_id: 5, purchase_id: 9, purchase_item_id: 1, invoice_number: '13021', source_ref: 'purchase-item:1:2026-10-10:620', purchase_quantity: 150, purchase_total_cents: 93000, pack_quantity: 10, units_per_pack: 15 }),
      undefined,
    )
    expect(rows[0]).toMatchObject({ cost_sync: 'synced', cost_version_id: 101, cost_previous_cents: 570, cost_variation_bps: 877, cost_sync_error: null })
  })

  it('a cost that rose is stored with the previous cost and variation; a small change raises no alert at the default 10% limit', async () => {
    const { service, rows } = make([pending()])
    await service.drain(9)

    expect(rows[0].cost_alerts).toEqual([])
  })

  it('a variation at or above the limit raises large_variation (up or down)', async () => {
    const up = make([pending({ unit_cost_cents: 700 })])
    await up.service.drain(9)
    expect(up.rows[0].cost_alerts).toEqual(['large_variation'])

    const down = make([pending({ unit_cost_cents: 500 })])
    await down.service.drain(9)
    expect(down.rows[0].cost_alerts).toEqual(['large_variation'])

    const looser = make([pending({ unit_cost_cents: 700 })], { config: { COST_VARIATION_ALERT_BPS: 5000 } })
    await looser.service.drain(9)
    expect(looser.rows[0].cost_alerts).toEqual([])
  })

  it('the same cost already in force is stored as unchanged: no version, no closed-month question', async () => {
    const record = jest.fn(async () => ({ created: false, unchanged: true, version_id: null, cost_cents: 620, previous_cost_cents: 620 }))
    const { service, rows, accounting } = make([pending()], { record, month: 'closed' })

    await service.drain(9)

    expect(rows[0]).toMatchObject({ cost_sync: 'unchanged', cost_version_id: null, cost_alerts: [] })
    expect(accounting.monthStatus).not.toHaveBeenCalled()
  })

  it('a bonus is never sent', async () => {
    expect(CostSyncService.initialState('bonus')).toBe('skipped_bonus')
    const { service, rows, record } = make([pending({ condition: 'bonus', cost_sync: 'skipped_bonus' })])

    expect(await service.drain(9)).toEqual({ sent: 0, failed: 0 })
    expect(record).not.toHaveBeenCalled()
    expect(rows[0].cost_sync).toBe('skipped_bonus')
  })

  it('a version dated in a closed month is flagged closed_month; an unreachable accounting is flagged unknown, never open', async () => {
    const closed = make([pending()], { month: 'closed' })
    await closed.service.drain(9)
    expect(closed.rows[0].cost_alerts).toEqual(['closed_month'])
    expect(closed.accounting.monthStatus).toHaveBeenCalledWith('2026-10', undefined)

    const unknown = make([pending()], { month: 'unknown' })
    await unknown.service.drain(9)
    expect(unknown.rows[0].cost_alerts).toEqual(['closed_month_unknown'])
  })

  it('sending twice does not resend what already went: only pending/failed items are read', async () => {
    const { service, record } = make([pending()])

    await service.drain(9)
    await service.drain(9)

    expect(record).toHaveBeenCalledTimes(1)
  })

  it('a failure stays visible on the item with its error and attempt, and does not stop the other items', async () => {
    const record = jest.fn(async (sku: string, input: any) => {
      if (sku === 'BAD') throw new Error('POST /products/BAD/costs -> 503')
      return { created: true, unchanged: false, version_id: 1, cost_cents: input.cost_cents, previous_cost_cents: null }
    })
    const { service, rows } = make([pending({ sku: 'BAD' }), pending({ sku: 'GOOD' })], { record })

    expect(await service.drain(9)).toEqual({ sent: 1, failed: 1 })

    expect(rows[0]).toMatchObject({ cost_sync: 'failed', cost_sync_attempts: 1, cost_sync_error: expect.stringContaining('503') })
    expect(rows[1].cost_sync).toBe('synced')
  })

  it('retry puts failed items back and sends them again with a fresh attempt count', async () => {
    let healthy = false
    const record = jest.fn(async (_sku: string, input: any) => {
      if (!healthy) throw new Error('down')
      return { created: true, unchanged: false, version_id: 7, cost_cents: input.cost_cents, previous_cost_cents: null }
    })
    const { service, rows } = make([pending()], { record })
    await service.drain(9)
    expect(rows[0].cost_sync).toBe('failed')

    healthy = true
    expect(await service.retry(9)).toEqual({ sent: 1, failed: 0 })
    expect(rows[0]).toMatchObject({ cost_sync: 'synced', cost_sync_error: null })
  })

  it('after the maximum attempts an item waits for a manual retry', async () => {
    const record = jest.fn(async () => { throw new Error('down') })
    const { service, rows } = make([pending({ cost_sync: 'failed', cost_sync_attempts: 8 })], { record })

    expect(await service.drain(9)).toEqual({ sent: 0, failed: 0 })
    expect(record).not.toHaveBeenCalled()
    expect(rows[0].cost_sync).toBe('failed')
  })

  it('the background loop waits for the backoff of a failed item; a manual drain of one purchase does not', async () => {
    const recent = new Date()
    const { service, record } = make([pending({ cost_sync: 'failed', cost_sync_attempts: 1, cost_sync_attempted_at: recent })])

    expect(await service.drain()).toEqual({ sent: 0, failed: 0 })
    expect(record).not.toHaveBeenCalled()
    expect(await service.drain(9)).toEqual({ sent: 1, failed: 0 })
  })

  it('markItems queues non-bonus items and records bonus as skipped, resetting the attempt state', async () => {
    const { service, rows, prisma } = make([pending({ cost_sync: 'failed', cost_sync_attempts: 3, cost_sync_error: 'x' }), pending({ condition: 'bonus', cost_sync: null })])

    await service.markItems(prisma as never, [{ id: 1, condition: 'paid' }, { id: 2, condition: 'bonus' }])

    expect(rows[0]).toMatchObject({ cost_sync: 'pending', cost_sync_attempts: 0, cost_sync_error: null })
    expect(rows[1].cost_sync).toBe('skipped_bonus')
  })
})

import { BadRequestException, ConflictException } from '@nestjs/common'
import { ClosingService } from './closing.service'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const d = (v: string) => new Date(`${v}T00:00:00Z`)

function build(opts: { settlements?: Row[]; costs?: Row[]; agreement?: Row | null; sold?: unknown } = {}) {
  const created: Row[] = []
  const settlements = opts.settlements ?? []
  const prisma = {
    supplier: { findUnique: async ({ where }: Row) => (where.id === 75 ? { id: 75, name: 'Quinoa' } : null) },
    settlement: {
      findMany: async () => settlements,
      create: async ({ data }: Row) => (created.push(data), { id: 1, ...data }),
    },
    consignmentAgreement: { findUnique: async () => opts.agreement ?? null },
    consignmentCost: { findMany: async () => opts.costs ?? [] },
  }
  const sales = { soldBySku: jest.fn(async () => opts.sold ?? { rows: [], months_without_dated_receipts: [], stores_missing: 0 }) }
  const supply = { removals: jest.fn(async () => ({ from: '2026-09', to: '2026-10', months_with_data: ['2026-09', '2026-10'], rows: [{ period: '2026-09', sku: 'A', reason: 'expired', quantity: 4 }, { period: '2026-10', sku: 'A', reason: 'other_reason', quantity: 2 }] })) }
  const products = { products: async () => [{ sku: 'A', name: 'Pão de mel' }] }
  const settlementSvc = { last: async () => null, findById: async (id: number) => ({ id }) }
  const service = new ClosingService(prisma as never, sales as never, supply as never, products as never, settlementSvc as never)

  return { service, created, sales, supply, settlementSvc }
}

const q = { supplier_id: 75, period_from: '2026-09-30', period_to: '2026-10-12' }
const cost = { sku: 'A', valid_from: d('2026-09-22'), unit_cost_cents: 730 }

describe('ClosingService.preview', () => {
  it('without agreed costs the supplier is not ready: config_pending, and sales are not even read', async () => {
    const { service, sales } = build()
    const view = await service.preview(q)

    expect(view.status).toBe('config_pending')
    expect(view.config_missing).toEqual(['products'])
    expect(sales.soldBySku).not.toHaveBeenCalled()
  })

  it('a period sharing days with a paid settlement is a conflict that says which one and where the next period starts', async () => {
    const { service } = build({ settlements: [{ id: 1, period_start: d('2026-09-22'), period_end: d('2026-09-30'), state: 'paid' }], costs: [cost] })
    const view = await service.preview({ ...q, period_from: '2026-09-29' })

    expect(view.status).toBe('conflict')
    expect(view.conflict).toEqual({ settlement_id: 1, period_from: '2026-09-22', period_to: '2026-09-29', state: 'paid', suggested_from: '2026-09-30' })
    expect(view.confirmable).toBe(false)
  })

  it('adjacent to the last settlement is fine (30/09 starts the day after 29/09)', async () => {
    const { service } = build({ settlements: [{ id: 1, period_start: d('2026-09-22'), period_end: d('2026-09-30'), state: 'paid' }], costs: [cost], sold: { rows: [{ sku: 'A', quantity: 50 }], months_without_dated_receipts: [], stores_missing: 0 } })
    const view = await service.preview(q)

    expect(view.status).toBe('ready')
    expect(view.total_cents).toBe(36500)
    expect(view.lines[0].name).toBe('Pão de mel')
    expect(view.removals?.lines).toEqual([
      expect.objectContaining({ sku: 'A', name: 'Pão de mel', month: '2026-09', expired: { units: 4, cents: 2920 } }),
      expect.objectContaining({ sku: 'A', month: '2026-10', other_reason: { units: 2, cents: 1460 } }),
    ])
  })

  it('expired and other-reason units are shown beside the sales and never added to the amount to settle', async () => {
    const { service } = build({ costs: [cost], sold: { rows: [{ sku: 'A', quantity: 50 }], months_without_dated_receipts: [], stores_missing: 0 } })
    const view = await service.preview(q)

    expect(view.total_cents).toBe(36500)
    expect(view.removals?.totals.expired.units).toBe(4)
  })

  it('when the supply data cannot be read the closing still answers, with removals unknown (null), never zero', async () => {
    const { service, supply } = build({ costs: [cost], sold: { rows: [{ sku: 'A', quantity: 50 }], months_without_dated_receipts: [], stores_missing: 0 } })
    supply.removals.mockRejectedValueOnce(new Error('down'))
    const view = await service.preview(q)

    expect(view.status).toBe('ready')
    expect(view.removals).toBeNull()
  })

  it('refuses today and future days, and an inverted period', async () => {
    const { service } = build({ costs: [cost] })

    await expect(service.preview({ ...q, period_to: '2999-01-01' })).rejects.toThrow(BadRequestException)
    await expect(service.preview({ ...q, period_to: '2026-09-01' })).rejects.toThrow(BadRequestException)
  })

  it('consulting never stores anything', async () => {
    const { service, created } = build({ costs: [cost], sold: { rows: [{ sku: 'A', quantity: 5 }], months_without_dated_receipts: [], stores_missing: 0 } })
    await service.preview(q)

    expect(created).toHaveLength(0)
  })
})

describe('ClosingService.confirm', () => {
  it('stores a confirmed closing with the recalculated total and its lines', async () => {
    const { service, created } = build({ costs: [cost], sold: { rows: [{ sku: 'A', quantity: 50 }], months_without_dated_receipts: [], stores_missing: 0 } })
    await service.confirm(q)

    expect(created[0]).toMatchObject({ supplier_id: 75, kind: 'closing', state: 'confirmed', owed_cents: 36500, partial: false })
    expect(created[0].period_end).toEqual(d('2026-10-13'))
  })

  it('refuses a conflict, a missing configuration, no sales and an unaccepted incomplete period', async () => {
    const empty = { rows: [], months_without_dated_receipts: [], stores_missing: 0 }

    await expect(build().service.confirm(q)).rejects.toThrow(BadRequestException)
    await expect(build({ costs: [cost], sold: empty }).service.confirm(q)).rejects.toThrow(BadRequestException)
    await expect(build({ costs: [cost], settlements: [{ id: 1, period_start: d('2026-09-22'), period_end: d('2026-10-05'), state: 'confirmed' }] }).service.confirm(q)).rejects.toThrow(ConflictException)
    const stores = { rows: [{ sku: 'A', quantity: 5 }], months_without_dated_receipts: [], stores_missing: 2 }
    await expect(build({ costs: [cost], sold: stores }).service.confirm(q)).rejects.toThrow(BadRequestException)
  })

  it('accepts a period that only lacks a store import, when the person says so; never one with unknown dates', async () => {
    const stores = { rows: [{ sku: 'A', quantity: 5 }], months_without_dated_receipts: [], stores_missing: 2 }
    const { service, created } = build({ costs: [cost], sold: stores })
    await service.confirm({ ...q, accept_incomplete: true })
    expect(created[0].partial).toBe(true)

    const unknown = { rows: [{ sku: 'A', quantity: 5 }], months_without_dated_receipts: ['2026-10'], stores_missing: 0 }
    await expect(build({ costs: [cost], sold: unknown }).service.confirm({ ...q, accept_incomplete: true })).rejects.toThrow(BadRequestException)
  })
})

describe('ClosingService.confirm — vencidas e outro motivo escolhidos', () => {
  const sold = { rows: [{ sku: 'A', quantity: 50 }], months_without_dated_receipts: [], stores_missing: 0 }

  it('the owed amount is the sales plus ONLY the removals the person picked, valued by the server', async () => {
    const { service, created } = build({ costs: [cost], sold })
    await service.confirm({ ...q, extras: [{ sku: 'A', month: '2026-09', kind: 'expired' }] })

    expect(created[0].owed_cents).toBe(36500 + 2920)
    expect(created[0].evidence.extras).toEqual([expect.objectContaining({ sku: 'A', month: '2026-09', kind: 'expired', units: 4, total_cents: 2920, unit_cost_cents: 730 })])
  })

  it('without a choice nothing extra is paid, even if there are removals', async () => {
    const { service, created } = build({ costs: [cost], sold })
    await service.confirm(q)

    expect(created[0].owed_cents).toBe(36500)
    expect(created[0].evidence.extras).toEqual([])
  })

  it('refuses a removal that does not exist, one chosen twice, and a kind with no units', async () => {
    const { service } = build({ costs: [cost], sold })

    await expect(service.confirm({ ...q, extras: [{ sku: 'A', month: '2026-08', kind: 'expired' }] })).rejects.toThrow(BadRequestException)
    await expect(service.confirm({ ...q, extras: [{ sku: 'A', month: '2026-09', kind: 'other_reason' }] })).rejects.toThrow(BadRequestException)
    await expect(service.confirm({ ...q, extras: [{ sku: 'A', month: '2026-09', kind: 'expired' }, { sku: 'A', month: '2026-09', kind: 'expired' }] })).rejects.toThrow(BadRequestException)
  })
})

describe('ClosingService.status', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-20T15:00:00Z') }))
  afterEach(() => jest.useRealTimers())

  it('suggests the day after the last settlement, with the agreed length, never past yesterday', async () => {
    const { service, settlementSvc } = build({ agreement: { period_days: 14, first_closing_on: null }, costs: [cost] })
    settlementSvc.last = async () => ({ period_to: '2026-09-29' }) as never

    const status = await service.status(75)

    expect(status.suggested).toEqual({ from: '2026-09-30', to: '2026-10-13' })
    expect(status.configured_skus).toBe(1)
  })

  it('cuts the suggestion at yesterday (São Paulo): a day that is not over cannot be closed', async () => {
    jest.setSystemTime(new Date('2026-10-13T02:00:00Z')) // 12/10 23:00 in São Paulo: yesterday is 11/10
    const { service, settlementSvc } = build({ agreement: { period_days: 14, first_closing_on: null } })
    settlementSvc.last = async () => ({ period_to: '2026-09-29' }) as never

    expect((await service.status(75)).suggested).toEqual({ from: '2026-09-30', to: '2026-10-11' })
  })

  it('without history or agreement there is nothing to suggest, and it says why', async () => {
    const status = await build().service.status(75)

    expect(status.suggested).toBeNull()
    expect(status.suggestion_reason).toBe('no_history')
  })
})

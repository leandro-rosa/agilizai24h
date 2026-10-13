import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { SettlementService } from './settlement.service'
import type { LegacySettlementDto } from '../dto/legacy-settlement.dto'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Just enough of Prisma for the settlement service: an in-memory `settlement` table and a supplier list. */
function fakePrisma(initial: Row[] = [], supplierIds = [7]) {
  const rows: Row[] = [...initial]
  const calls: { findMany: Row[] } = { findMany: [] }
  let nextId = 100
  const supplier = { id: 7, name: 'Fornecedor teste' }
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key])
      if (value && typeof value === 'object' && 'not' in value) return row[key] !== value.not
      return row[key] === value
    })

  return {
    rows,
    calls,
    supplier: { findUnique: async ({ where }: Row) => (supplierIds.includes(where.id) ? { ...supplier, id: where.id } : null) },
    purchase: { findMany: async () => [{ received_on: new Date('2026-09-01T00:00:00Z'), ordered_on: new Date('2026-09-01T00:00:00Z'), items: [{ id: 1, sku: 'A', quantity: 10, received_quantity: null, unit_cost_cents: 100 }] }] },
    settlement: {
      findMany: async ({ where }: Row = {}) => {
        calls.findMany.push(where ?? {})
        return rows.filter(row => matches(row, where))
      },
      findFirst: async ({ where, orderBy }: Row) => {
        const found = rows.filter(row => matches(row, where))
        const [field] = Object.keys((orderBy as Row[])[0])
        return found.sort((a, b) => b[field].getTime() - a[field].getTime() || b.id - a.id)[0] ?? null
      },
      findUnique: async ({ where }: Row) => rows.find(row => (where.id !== undefined ? row.id === where.id : row.supplier_id === where.supplier_id_week_start?.supplier_id && row.week_start.getTime() === where.supplier_id_week_start.week_start.getTime())) ?? null,
      create: async ({ data }: Row) => {
        const row = { id: nextId++, partial: false, confirmed_at: null, paid_on: null, payment_note: null, ...data, supplier }
        rows.push(row)
        return row
      },
      upsert: async ({ create }: Row) => {
        const row = { id: nextId++, ...create, confirmed_at: null, paid_on: null, payment_note: null, supplier }
        rows.push(row)
        return row
      },
      update: async ({ where, data }: Row) => Object.assign(rows.find(row => row.id === where.id) as Row, data, { supplier }),
    },
  }
}

const fakeSales = { soldBySku: async () => ({ from: '', to: '', rows: [], months_without_dated_receipts: [], stores_missing: 0 }) }
const service = (prisma = fakePrisma()) => ({ prisma, svc: new SettlementService(prisma as never, fakeSales as never) })

const dto = (over: Partial<LegacySettlementDto> = {}): LegacySettlementDto => ({
  supplier_id: 7,
  period_from: '2026-09-22',
  period_to: '2026-09-29',
  paid_on: '2026-09-30',
  total_cents: 22692,
  lines: [
    { name: 'Pão de mel', sku: '110022', unit_cost_cents: 730, quantity: 30, total_cents: 21900 },
    { name: 'Pizza de marguerita', sku: '9992', unit_cost_cents: 792, quantity: 1, total_cents: 792 },
  ],
  source: 'planilha',
  actor: 'dono@agiliz',
  ...over,
})

describe('SettlementService.registerLegacy', () => {
  it('stores a paid legacy settlement covering both selected days', async () => {
    const { svc } = service()

    const view = await svc.registerLegacy(dto())

    expect(view).toMatchObject({ kind: 'legacy', state: 'paid', owed_cents: 22692, period_from: '2026-09-22', period_to: '2026-09-29', paid_on: '2026-09-30', counts_as_owed: true })
  })

  it('refuses a settlement that does not add up, with the reasons', async () => {
    const { svc } = service()

    await expect(svc.registerLegacy(dto({ total_cents: 1 }))).rejects.toThrow(BadRequestException)
  })

  it('refuses an unknown supplier', async () => {
    const { svc } = service()

    await expect(svc.registerLegacy(dto({ supplier_id: 99 }))).rejects.toThrow(NotFoundException)
  })

  it('refuses days that an earlier confirmed or paid settlement already covers — nothing is charged twice', async () => {
    const { svc } = service()
    await svc.registerLegacy(dto())

    await expect(svc.registerLegacy(dto({ period_from: '2026-09-29', period_to: '2026-10-05', paid_on: '2026-10-06' }))).rejects.toThrow(ConflictException)
  })

  it('refuses the same settlement registered twice', async () => {
    const { svc } = service()
    await svc.registerLegacy(dto())

    await expect(svc.registerLegacy(dto())).rejects.toThrow(ConflictException)
  })
})

describe('SettlementService.last', () => {
  it('is the most recent confirmed or paid settlement by the last day it covers, never a proposal', async () => {
    const { svc } = service()
    await svc.registerLegacy(dto())
    await svc.registerLegacy(dto({ period_from: '2026-09-01', period_to: '2026-09-08', paid_on: '2026-09-09' }))

    const last = await svc.last(7)

    expect(last).toMatchObject({ period_from: '2026-09-22', period_to: '2026-09-29', kind: 'legacy' })
  })

  it('is null when the supplier has no confirmed or paid settlement', async () => {
    const { svc } = service()

    expect(await svc.last(7)).toBeNull()
  })
})

describe('SettlementService.propose — guards', () => {
  it('refuses a week that touches the days a legacy settlement already covers', async () => {
    const { svc } = service()
    await svc.registerLegacy(dto())

    await expect(svc.propose({ supplier_id: 7, week_start: '2026-09-21' })).rejects.toThrow(ConflictException)
  })

  it('reads the running balance only from REGULAR confirmed or paid settlements, so a legacy one never reaches it', async () => {
    const { svc, prisma } = service()
    await svc.registerLegacy(dto())

    await svc.propose({ supplier_id: 7, week_start: '2026-10-05' })

    const priorQuery = prisma.calls.findMany.find(where => where.kind === 'regular')
    expect(priorQuery).toBeDefined()
    expect(priorQuery?.state).toEqual({ in: ['confirmed', 'paid'] })
  })

  it('covers a chosen period (29/09 to 12/10, both included) instead of a week', async () => {
    const { svc } = service()

    const view = await svc.propose({ supplier_id: 7, period_from: '2026-09-29', period_to: '2026-10-12' })

    expect(view.period_from).toBe('2026-09-29')
    expect(view.period_to).toBe('2026-10-12')
  })

  it('refuses an inverted or half-given period', async () => {
    const { svc } = service()

    await expect(svc.propose({ supplier_id: 7, period_from: '2026-10-12', period_to: '2026-09-29' })).rejects.toThrow(BadRequestException)
    await expect(svc.propose({ supplier_id: 7, period_from: '2026-09-29' })).rejects.toThrow(BadRequestException)
  })
})

describe('SettlementService.cancel', () => {
  const closing = (over: Row = {}) => ({ id: 5, supplier_id: 7, week_start: new Date('2026-09-30T00:00:00Z'), kind: 'closing', period_start: new Date('2026-09-30T00:00:00Z'), period_end: new Date('2026-10-13T00:00:00Z'), state: 'confirmed', owed_cents: 225355, partial: false, evidence: { kind: 'closing', lines: [] }, confirmed_at: new Date(), paid_on: null, payment_note: null, ...over })

  it('cancels a confirmed closing, keeping who, why and how much it was worth, and gives its start day back', async () => {
    const { svc, prisma } = service(fakePrisma([closing()]))
    const view = await svc.cancel(5, 'Faltou marcar o outro motivo', 'dono@agiliz')

    expect(view.state).toBe('cancelled')
    expect(view.counts_as_owed).toBe(true) // the flag only says "not a proposal"; the open total ignores cancelled rows
    expect((prisma.rows[0].evidence as Row).cancelled).toMatchObject({ by: 'dono@agiliz', reason: 'Faltou marcar o outro motivo', original_week_start: '2026-09-30', owed_cents: 225355 })
    expect(prisma.rows[0].week_start.toISOString().slice(0, 10)).not.toBe('2026-09-30')
  })

  it('refuses a paid closing, a legacy settlement and one already cancelled', async () => {
    const { svc } = service(fakePrisma([closing({ id: 6, state: 'paid' }), closing({ id: 7, kind: 'legacy', state: 'paid' }), closing({ id: 8, state: 'cancelled' })]))

    await expect(svc.cancel(6, 'engano')).rejects.toThrow(ConflictException)
    await expect(svc.cancel(7, 'engano')).rejects.toThrow(ConflictException)
    await expect(svc.cancel(8, 'engano')).rejects.toThrow(ConflictException)
    await expect(svc.cancel(99, 'engano')).rejects.toThrow(NotFoundException)
  })
})

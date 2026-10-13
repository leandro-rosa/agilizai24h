import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { ConsignmentAgreementService } from './consignment-agreement.service'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function fakePrisma() {
  const agreements: Row[] = []
  const costs: Row[] = []
  let nextId = 1
  return {
    agreements,
    costs,
    supplier: { findUnique: async ({ where }: Row) => (where.id === 7 ? { id: 7 } : null) },
    consignmentAgreement: {
      findUnique: async ({ where }: Row) => agreements.find(a => a.supplier_id === where.supplier_id) ?? null,
      upsert: async ({ where, create, update }: Row) => {
        const found = agreements.find(a => a.supplier_id === where.supplier_id)
        if (found) return Object.assign(found, update)
        const row = { id: nextId++, cost_basis: 'sale_date', first_closing_on: null, ...create }
        agreements.push(row)
        return row
      },
    },
    consignmentCost: {
      findMany: async ({ where }: Row) => costs.filter(c => c.supplier_id === where.supplier_id),
      create: async ({ data }: Row) => {
        if (costs.some(c => c.supplier_id === data.supplier_id && c.sku === data.sku && c.valid_from.getTime() === data.valid_from.getTime())) throw Object.assign(new Error('unique'), { code: 'P2002' })
        const row = { id: nextId++, ...data }
        costs.push(row)
        return row
      },
    },
  }
}

const make = () => {
  const prisma = fakePrisma()
  return { prisma, svc: new ConsignmentAgreementService(prisma as never) }
}

describe('ConsignmentAgreementService', () => {
  it('has no agreement and no costs until one is registered', async () => {
    const { svc } = make()

    expect(await svc.get(7)).toEqual({ agreement: null, costs: [] })
  })

  it('stores the periodicity and the first closing day, and updates the same agreement', async () => {
    const { svc } = make()

    await svc.put(7, { period_days: 7, first_closing_on: '2026-09-30' })
    const again = await svc.put(7, { period_days: 10 })

    expect(again).toMatchObject({ supplier_id: 7, period_days: 10, cost_basis: 'sale_date' })
    expect((await svc.get(7)).agreement?.period_days).toBe(10)
  })

  it('refuses an impossible periodicity, and an unknown supplier', async () => {
    const { svc } = make()

    await expect(svc.put(7, { period_days: 0 })).rejects.toThrow(BadRequestException)
    await expect(svc.put(99, { period_days: 7 })).rejects.toThrow(NotFoundException)
  })

  it('adds costs as new vigências and never edits one: the same day twice is a conflict', async () => {
    const { svc } = make()

    await svc.addCost(7, { sku: '110022', valid_from: '2026-09-01', unit_cost_cents: 730 })
    await svc.addCost(7, { sku: '110022', valid_from: '2026-10-05', unit_cost_cents: 760 })

    await expect(svc.addCost(7, { sku: '110022', valid_from: '2026-09-01', unit_cost_cents: 999 })).rejects.toThrow(ConflictException)
    const { costs } = await svc.get(7)
    expect(costs.map(c => [c.valid_from, c.unit_cost_cents])).toEqual([['2026-09-01', 730], ['2026-10-05', 760]])
  })

  it('refuses a negative cost and an unreal start day', async () => {
    const { svc } = make()

    await expect(svc.addCost(7, { sku: 'A', valid_from: '2026-02-30', unit_cost_cents: -1 })).rejects.toThrow(BadRequestException)
  })
})

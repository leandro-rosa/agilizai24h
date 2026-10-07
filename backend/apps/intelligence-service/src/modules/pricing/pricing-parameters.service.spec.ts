import { PricingParametersInvalidError } from './pricing.parameters'
import { PricingParametersService, withPricingDefaults } from './pricing-parameters.service'

function fakePrisma() {
  const rows: { id: number; created_at: Date; note: string | null; values: unknown }[] = []
  const table = {
    count: async () => rows.length,
    create: async ({ data }: { data: { note: string | null; values: unknown } }) => {
      const row = { id: rows.length + 1, created_at: new Date(), note: data.note, values: structuredClone(data.values) }
      rows.push(row)
      return row
    },
    findFirst: async () => rows[rows.length - 1] ?? null,
    findUnique: async ({ where }: { where: { id: number } }) => rows.find(row => row.id === where.id) ?? null,
    findMany: async () => [...rows].reverse(),
  }

  return { prisma: { pricingParameterVersion: table } as never, rows }
}

describe('PricingParametersService', () => {
  it('starts with version 1 from the defaults, with the 35% reference and no tax rate', async () => {
    const { prisma } = fakePrisma()
    const service = new PricingParametersService(prisma)
    const current = await service.current()

    expect(current.id).toBe(1)
    expect(current.values.margin.targetBps).toBe(3500)
    expect(current.values.taxRateBps).toBeNull()
  })

  it('creates a new version on change and keeps the previous readable', async () => {
    const { prisma } = fakePrisma()
    const service = new PricingParametersService(prisma)
    await service.current()
    const next = await service.createVersion({ margin: { targetBps: 3800 } }, 'owner recalibration')

    expect(next.id).toBe(2)
    expect((await service.current()).values.margin.targetBps).toBe(3800)
    expect((await service.byId(1)).values.margin.targetBps).toBe(3500)
    expect((await service.list()).map(version => version.id)).toEqual([2, 1])
  })

  it('stores a category override and a tax rate', async () => {
    const { prisma } = fakePrisma()
    const service = new PricingParametersService(prisma)
    const next = await service.createVersion({ taxRateBps: 707, margin: { categories: { Combos: { minimumBps: 3000, targetBps: 3000 } } } })

    expect(next.values.taxRateBps).toBe(707)
    expect(next.values.margin.categories.Combos).toEqual({ minimumBps: 3000, targetBps: 3000 })
  })

  it('refuses an invalid change and creates nothing', async () => {
    const { prisma, rows } = fakePrisma()
    const service = new PricingParametersService(prisma)
    await service.current()

    await expect(service.createVersion({ margin: { targetBps: 2000, minimumBps: 3000 } })).rejects.toBeInstanceOf(PricingParametersInvalidError)
    expect(rows).toHaveLength(1)
  })

  it('reads an old version with defaults for parameters that did not exist yet', () => {
    const old = withPricingDefaults({ margin: { targetBps: 4000 } })

    expect(old.margin.targetBps).toBe(4000)
    expect(old.margin.minimumBps).toBe(3000)
    expect(old.rounding.stepCents).toBe(10)
  })
})

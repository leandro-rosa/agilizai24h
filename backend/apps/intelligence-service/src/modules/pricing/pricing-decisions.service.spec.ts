import { BadRequestException, ConflictException } from '@nestjs/common'
import { PricingDecisionsService } from './pricing-decisions.service'

interface Row {
  [key: string]: any
}

function build(options: { recommended?: number | null; priceInForce?: number | null } = {}) {
  const rows: Row[] = []
  const prisma = {
    pricingDecision: {
      findUnique: async ({ where }: any) => rows.find(row => (where.id ? row.id === where.id : row.idempotency_key === where.idempotency_key)) ?? null,
      create: async ({ data }: any) => {
        const row = { error: null, created_at: new Date(), updated_at: new Date(), ...data }
        rows.push(row)
        return row
      },
      update: async ({ where, data }: any) => Object.assign(rows.find(row => row.id === where.id)!, data, { updated_at: new Date() }),
      findMany: async ({ where, orderBy, take }: any) => {
        let found = rows.filter(row => (!where?.sku || row.sku === where.sku) && (!where?.status || row.status === where.status) && (!where?.created_at?.lt || row.created_at < where.created_at.lt))
        found = [...found].sort((a, b) => (orderBy?.created_at === 'asc' ? 1 : -1) * (a.created_at.getTime() - b.created_at.getTime()))
        return take ? found.slice(0, take) : found
      },
    },
  }
  const products = {
    pricesAsOf: async (skus: string[]) => ({
      resolved: options.priceInForce === null ? [] : [{ sku: skus[0], product_id: 1, price_cents: options.priceInForce ?? 590, effective_from: '2026-01-01' }],
      unresolved: [],
      complete: true,
    }),
  }
  const report = { products: [{ sku: 'COCA', recommendedPriceCents: options.recommended === undefined ? 650 : options.recommended, confidence: 'high' }] }
  const runs = {
    latest: async () => ({ report, run: { id: 'run-1', parameterVersion: 4 } }),
    getWithReport: async (id: string) => (id === 'run-old' ? { view: { id: 'run-old', parameterVersion: 2 }, report: { products: [{ sku: 'COCA', recommendedPriceCents: 640, confidence: 'medium' }] } } : null),
  }
  const service = new PricingDecisionsService(prisma as never, products as never, runs as never)

  return { service, rows }
}

const apply = (overrides: Record<string, unknown> = {}) => ({ idempotencyKey: 'k1', sku: 'COCA', newPriceCents: 650, actor: 'barbara@agiliz.ai', ...overrides })

describe('PricingDecisionsService.record', () => {
  it('records accepting the recommendation, with the previous price and recommendation taken on the server', async () => {
    const { service } = build()
    const { created, decision } = await service.record(apply())

    expect(created).toBe(true)
    expect(decision).toMatchObject({ sku: 'COCA', previousPriceCents: 590, newPriceCents: 650, recommendedPriceCents: 650, confidence: 'high', runId: 'run-1', parameterVersion: 4, actor: 'barbara@agiliz.ai', status: 'pending', reason: null })
    expect(decision.effectiveFrom).toBe(new Date().toISOString().slice(0, 10))
  })

  it('requires a reason when the new price differs from the recommendation', async () => {
    const { service, rows } = build()

    await expect(service.record(apply({ newPriceCents: 620 }))).rejects.toBeInstanceOf(BadRequestException)
    expect(rows).toHaveLength(0)
    const { decision } = await service.record(apply({ newPriceCents: 620, reason: 'preço da concorrência' }))
    expect(decision).toMatchObject({ newPriceCents: 620, recommendedPriceCents: 650, reason: 'preço da concorrência' })
  })

  it('requires a reason when the engine recommended nothing', async () => {
    const { service } = build({ recommended: null })

    await expect(service.record(apply())).rejects.toBeInstanceOf(BadRequestException)
    expect((await service.record(apply({ reason: 'ajuste manual' }))).decision.recommendedPriceCents).toBeNull()
  })

  it('does not need a reason when the user approves exactly the recommendation', async () => {
    const { service } = build()

    await expect(service.record(apply())).resolves.toBeDefined()
  })

  it('uses the run the user was looking at, not the latest', async () => {
    const { service } = build()
    const { decision } = await service.record(apply({ runId: 'run-old', newPriceCents: 640 }))

    expect(decision).toMatchObject({ runId: 'run-old', parameterVersion: 2, recommendedPriceCents: 640, confidence: 'medium' })
  })

  it.each([[0], [-5], [6.5], ['650'], [null]])('rejects a new price of %p', async value => {
    const { service, rows } = build()

    await expect(service.record(apply({ newPriceCents: value }))).rejects.toBeInstanceOf(BadRequestException)
    expect(rows).toHaveLength(0)
  })

  it('rejects a missing key, product or actor and an impossible date', async () => {
    const { service } = build()

    await expect(service.record(apply({ idempotencyKey: '' }))).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.record(apply({ sku: '' }))).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.record(apply({ actor: '' }))).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.record(apply({ effectiveFrom: '2026-02-31' }))).rejects.toBeInstanceOf(BadRequestException)
  })

  it('the same request twice is one decision', async () => {
    const { service, rows } = build()
    const first = await service.record(apply())
    const second = await service.record(apply())

    expect(first.created).toBe(true)
    expect(second).toMatchObject({ created: false, decision: { id: first.decision.id } })
    expect(rows).toHaveLength(1)
  })

  it('records a product that had no price before as a null previous price', async () => {
    const { service } = build({ priceInForce: null })

    expect((await service.record(apply())).decision.previousPriceCents).toBeNull()
  })
})

describe('closing a decision', () => {
  it('marks it applied after the price write', async () => {
    const { service } = build()
    const { decision } = await service.record(apply())

    expect(await service.markApplied(decision.id)).toMatchObject({ status: 'applied', error: null })
  })

  it('marks it failed with the reason when the price write fails', async () => {
    const { service } = build()
    const { decision } = await service.record(apply())

    expect(await service.markFailed(decision.id, 'products-service unavailable')).toMatchObject({ status: 'failed', error: 'products-service unavailable' })
  })

  it('never rewrites an applied decision as failed', async () => {
    const { service } = build()
    const { decision } = await service.record(apply())
    await service.markApplied(decision.id)

    await expect(service.markFailed(decision.id, 'late failure')).rejects.toBeInstanceOf(ConflictException)
    expect(await service.markApplied(decision.id)).toMatchObject({ status: 'applied' })
  })
})

describe('reading decisions', () => {
  it('lists two same-day changes with their own previous and new prices, newest first', async () => {
    const { service, rows } = build()
    const first = await service.record(apply({ idempotencyKey: 'a', newPriceCents: 650 }))
    await service.markApplied(first.decision.id)
    rows[0].created_at = new Date(Date.now() - 60_000)
    const second = await service.record(apply({ idempotencyKey: 'b', newPriceCents: 620, reason: 'volta' }))
    await service.markApplied(second.decision.id)

    const list = await service.list({ sku: 'COCA' })

    expect(list.map(decision => decision.newPriceCents)).toEqual([620, 650])
  })

  it('lists pending decisions older than the limit and not the recent ones', async () => {
    const { service, rows } = build()
    const old = await service.record(apply({ idempotencyKey: 'old' }))
    rows[0].created_at = new Date(Date.now() - 10 * 60_000)
    await service.record(apply({ idempotencyKey: 'new' }))

    const stale = await service.stalePending(5)

    expect(stale.map(decision => decision.id)).toEqual([old.decision.id])
  })
})

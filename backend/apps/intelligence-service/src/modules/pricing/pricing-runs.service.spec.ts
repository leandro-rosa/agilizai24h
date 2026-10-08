import { BadRequestException } from '@nestjs/common'
import { PricingRunsService, STALE_AFTER_MS } from './pricing-runs.service'
import { PricingRunWorker } from './pricing-run.worker'
import { ENGINE_VERSION } from './pricing.types'
import type { PricingReport } from './pricing.service'

interface Row {
  id: string
  period: string
  store_id: number | null
  status: string
  engine_version: string
  parameter_version_id: number
  error: string | null
  report: unknown
  created_at: Date
  finished_at: Date | null
}

const REPORT = (version: number) => ({ meta: { parameterVersion: version, engineVersion: ENGINE_VERSION }, products: [{ sku: 'A' }] }) as unknown as PricingReport

function fake(parameterVersion = 1) {
  const rows: Row[] = []
  const matches = (row: Row, where: any): boolean =>
    Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
      const actual = (row as any)[key]
      if (value !== null && typeof value === 'object' && 'in' in value) return value.in.includes(actual)
      if (value !== null && typeof value === 'object' && 'lt' in value) return actual < value.lt
      return actual === value
    })
  const prisma = {
    pricingRun: {
      create: async ({ data }: any) => {
        const row: Row = { error: null, report: null, created_at: new Date(), finished_at: null, ...data }
        rows.push(row)
        return row
      },
      findFirst: async ({ where, orderBy }: any) => {
        const found = rows.filter(row => matches(row, where))
        const key = Object.keys(orderBy ?? {})[0]
        if (key) found.sort((a: any, b: any) => (b[key]?.getTime?.() ?? 0) - (a[key]?.getTime?.() ?? 0))
        return found[0] ?? null
      },
      findMany: async ({ where, orderBy, take }: any) => {
        const found = rows.filter(row => matches(row, where))
        const key = Object.keys(orderBy ?? {})[0]
        if (key) found.sort((a: any, b: any) => (b[key]?.getTime?.() ?? 0) - (a[key]?.getTime?.() ?? 0))
        return found.slice(0, take)
      },
      findUnique: async ({ where }: any) => rows.find(row => row.id === where.id) ?? null,
      updateMany: async ({ where, data }: any) => {
        const found = rows.filter(row => matches(row, where))
        found.forEach(row => Object.assign(row, data))
        return { count: found.length }
      },
      update: async ({ where, data }: any) => Object.assign(rows.find(row => row.id === where.id)!, data),
    },
  }
  const parameters = { current: async () => ({ id: parameterVersion }) }
  const sent: any[] = []
  const broker = { holdIt: async (message: any) => void sent.push(message) }
  const service = new PricingRunsService(prisma as never, parameters as never, broker as never)

  return { service, rows, sent, setVersion: (v: number) => void (parameterVersion = v) }
}

describe('PricingRunsService', () => {
  it('says explicitly that a scope never ran, instead of returning an empty report', async () => {
    const { service } = fake()
    const latest = await service.latest({ period: '2026-09' })

    expect(latest).toMatchObject({ state: 'none', run: null, report: null, inProgress: null })
  })

  it('reading returns the stored report and does not enqueue anything', async () => {
    const { service, sent } = fake()
    const { run } = await service.start({ period: '2026-09' })
    await service.markRunning(run.id)
    await service.complete(run.id, REPORT(1))
    const sentBefore = sent.length

    const latest = await service.latest({ period: '2026-09' })

    expect(latest.state).toBe('ready')
    expect(latest.report?.products).toHaveLength(1)
    expect(latest.run).toMatchObject({ engineVersion: ENGINE_VERSION, parameterVersion: 1, status: 'completed' })
    expect(sent.length).toBe(sentBefore)
  })

  it('returns the run in progress instead of starting a second', async () => {
    const { service, rows, sent } = fake()
    const first = await service.start({ period: '2026-09' })
    const second = await service.start({ period: '2026-09' })

    expect(first.started).toBe(true)
    expect(second).toMatchObject({ started: false, run: { id: first.run.id } })
    expect(rows).toHaveLength(1)
    expect(sent).toHaveLength(1)
  })

  it('keeps scopes apart: another store or the network is a separate run', async () => {
    const { service, rows } = fake()
    await service.start({ period: '2026-09' })
    await service.start({ period: '2026-09', storeId: 3 })

    expect(rows).toHaveLength(2)
  })

  it('a failed run keeps its reason and does not replace the completed one', async () => {
    const { service } = fake()
    const done = await service.start({ period: '2026-09' })
    await service.markRunning(done.run.id)
    await service.complete(done.run.id, REPORT(1))
    await new Promise(resolve => setTimeout(resolve, 5))
    const failing = await service.start({ period: '2026-09' })
    await service.markRunning(failing.run.id)
    await service.fail(failing.run.id, 'sales service unavailable')

    const latest = await service.latest({ period: '2026-09' })

    expect(latest.state).toBe('ready')
    expect(latest.run?.id).toBe(done.run.id)
    expect(latest.lastFailure).toMatchObject({ id: failing.run.id, error: 'sales service unavailable' })
  })

  it('stops showing an old failure once a newer run completed', async () => {
    const { service } = fake()
    const bad = await service.start({ period: '2026-09' })
    await service.fail(bad.run.id, 'boom')
    await new Promise(resolve => setTimeout(resolve, 5))
    const good = await service.start({ period: '2026-09' })
    await service.markRunning(good.run.id)
    await service.complete(good.run.id, REPORT(1))

    expect((await service.latest({ period: '2026-09' })).lastFailure).toBeNull()
  })

  it('flags a report computed under older parameters', async () => {
    const { service, setVersion } = fake(1)
    const { run } = await service.start({ period: '2026-09' })
    await service.markRunning(run.id)
    await service.complete(run.id, REPORT(1))
    setVersion(2)

    expect(await service.latest({ period: '2026-09' })).toMatchObject({ parametersStale: true, currentParameterVersion: 2 })
  })

  it('does not let a run that never finished block a new one', async () => {
    const { service, rows } = fake()
    const stuck = await service.start({ period: '2026-09' })
    rows[0].created_at = new Date(Date.now() - STALE_AFTER_MS - 1000)

    const next = await service.start({ period: '2026-09' })

    expect(next.started).toBe(true)
    expect(rows.find(row => row.id === stuck.run.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('Timed out') })
  })

  it('rejects a malformed period or store', async () => {
    const { service } = fake()

    await expect(service.start({ period: '2026-13' })).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.start({ period: '2026-09', storeId: -1 })).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('PricingRunWorker', () => {
  const job = (runId: string, attemptsMade = 0, attempts = 3) => ({ data: { schemaVersion: 1, runId }, attemptsMade, opts: { attempts }, id: 'j1' }) as never

  it('computes the report and stores it', async () => {
    const { service } = fake()
    const { run } = await service.start({ period: '2026-09' })
    const pricing = { report: jest.fn(async () => REPORT(1)) }
    await new PricingRunWorker(service, pricing as never).process(job(run.id))

    expect(pricing.report).toHaveBeenCalledWith({ period: '2026-09', storeId: undefined }, undefined)
    expect((await service.latest({ period: '2026-09' })).state).toBe('ready')
  })

  it('leaves a finished run alone when the job is redelivered', async () => {
    const { service } = fake()
    const { run } = await service.start({ period: '2026-09' })
    const pricing = { report: jest.fn(async () => REPORT(1)) }
    const worker = new PricingRunWorker(service, pricing as never)
    await worker.process(job(run.id))
    await worker.process(job(run.id))

    expect(pricing.report).toHaveBeenCalledTimes(1)
  })

  it('retries a transient failure and fails the run only on the last attempt', async () => {
    const { service } = fake()
    const { run } = await service.start({ period: '2026-09' })
    const worker = new PricingRunWorker(service, { report: async () => Promise.reject(new Error('timeout')) } as never)

    await expect(worker.process(job(run.id, 0, 3))).rejects.toThrow('timeout')
    expect((await service.get(run.id)).status).toBe('running')

    await worker.process(job(run.id, 2, 3))
    expect(await service.get(run.id)).toMatchObject({ status: 'failed', error: 'timeout' })
  })
})

describe('PricingRunsService — recalculating preserves the previous result', () => {
  it('a new calculation is a new run: the earlier report stays exactly as it was, with its own engine and rules versions', async () => {
    const { service, rows } = fake(1)
    const first = (await service.start({ period: '2026-09' })).run.id
    await service.complete(first, { meta: { parameterVersion: 1, engineVersion: 'pricing-3' }, products: [{ sku: 'A', currentMargin: 0.16 }] } as unknown as PricingReport)
    const before = JSON.stringify(rows.find(row => row.id === first))

    await new Promise(resolve => setTimeout(resolve, 5))
    const second = (await service.start({ period: '2026-09' })).run.id
    await service.complete(second, { meta: { parameterVersion: 2, engineVersion: 'pricing-4' }, products: [{ sku: 'A', currentMargin: 0.38 }] } as unknown as PricingReport)

    expect(second).not.toBe(first)
    expect(JSON.stringify(rows.find(row => row.id === first))).toBe(before)
    const history = await service.history({ period: '2026-09' })
    expect(history.map(run => [run.id, run.engineVersion, run.parameterVersion])).toEqual([[second, 'pricing-4', 2], [first, 'pricing-3', 1]])
  })

  it('reads an earlier run by id with its report, and a run with no completed report has none', async () => {
    const { service } = fake(1)
    const first = (await service.start({ period: '2026-09' })).run.id
    await service.complete(first, { meta: { parameterVersion: 1, engineVersion: 'pricing-3' }, products: [{ sku: 'A', currentMargin: 0.16 }] } as unknown as PricingReport)
    const queued = (await service.start({ period: '2026-10' })).run.id

    expect((await service.getWithReport(first))?.report?.products).toEqual([{ sku: 'A', currentMargin: 0.16 }])
    expect((await service.getWithReport(queued))?.report).toBeNull()
  })

  it('the history lists only completed runs of the scope', async () => {
    const { service } = fake(1)
    const done = (await service.start({ period: '2026-09' })).run.id
    await service.complete(done, REPORT(1))
    await service.start({ period: '2026-09' }) // queued, not completed
    await service.start({ period: '2026-08' }) // another scope

    expect((await service.history({ period: '2026-09' })).map(run => run.id)).toEqual([done])
  })
})

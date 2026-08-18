import { SupplyRowsWorker } from './supply-rows.worker'

const jobFor = (data: unknown) => ({ id: '1', data }) as never

describe('SupplyRowsWorker', () => {
  const build = (changed = true) => {
    const supply = { ingestPeriod: jest.fn().mockResolvedValue({ changed, restockCount: 0, removalCount: 0 }) }
    const events = { publishPeriodDataUpdated: jest.fn().mockResolvedValue(undefined) }
    return { worker: new SupplyRowsWorker(supply as never, events as never), supply, events }
  }

  const valid = {
    schemaVersion: 1,
    ingestionId: 'ing-1',
    storeId: 7,
    period: '2026-03',
    restocks: [{ sku: 'A', quantityRestocked: 10 }],
    removals: [{ sku: 'A', reason: 'expired', quantityRemoved: 2 }],
  }

  it('ingests and publishes when something changed', async () => {
    const { worker, supply, events } = build(true)

    await worker.process(jobFor(valid))

    expect(supply.ingestPeriod).toHaveBeenCalled()
    expect(events.publishPeriodDataUpdated).toHaveBeenCalledWith(7, '2026-03', undefined)
  })

  it('suppresses the event when nothing changed', async () => {
    // Re-uploading an identical file is normal; publishing anyway would cause a
    // downstream recomputation storm for no reason.
    const { worker, events } = build(false)

    await worker.process(jobFor(valid))

    expect(events.publishPeriodDataUpdated).not.toHaveBeenCalled()
  })

  it('publishes only after ingestion resolves, never before', async () => {
    const order: string[] = []
    const supply = {
      ingestPeriod: jest.fn().mockImplementation(async () => {
        order.push('ingest')
        return { changed: true }
      }),
    }
    const events = {
      publishPeriodDataUpdated: jest.fn().mockImplementation(async () => {
        order.push('publish')
      }),
    }

    await new SupplyRowsWorker(supply as never, events as never).process(jobFor(valid))

    expect(order).toEqual(['ingest', 'publish'])
  })

  it('carries the correlation id into the event', async () => {
    const { worker, events } = build(true)

    await worker.process(jobFor({ ...valid, correlationId: 'corr-9' }))

    expect(events.publishPeriodDataUpdated).toHaveBeenCalledWith(7, '2026-03', 'corr-9')
  })

  it('rejects an unknown payload version instead of mis-reading it', async () => {
    const { worker, supply } = build()

    await expect(worker.process(jobFor({ ...valid, schemaVersion: 2 }))).rejects.toThrow(/schemaVersion/)
    expect(supply.ingestPeriod).not.toHaveBeenCalled()
  })

  it('rejects a malformed period rather than writing under it', async () => {
    const { worker, supply } = build()

    await expect(worker.process(jobFor({ ...valid, period: 'marco/2026' }))).rejects.toThrow(/period/)
    expect(supply.ingestPeriod).not.toHaveBeenCalled()
  })

  it('treats missing restocks or removals as empty rather than failing', async () => {
    const { worker, supply } = build()

    await worker.process(jobFor({ ...valid, restocks: undefined, removals: undefined }))

    expect(supply.ingestPeriod).toHaveBeenCalledWith(expect.objectContaining({ restocks: [], removals: [] }))
  })
})

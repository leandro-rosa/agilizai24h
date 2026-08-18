import { SalesRowsWorker } from './sales-rows.worker'
import { INGESTION_QUEUES } from '@app/ingestion-contracts'

const jobFor = (data: unknown) => ({ id: '1', data, queueName: INGESTION_QUEUES.SALES_ROWS }) as never

describe('SalesRowsWorker', () => {
  const build = (changed = true) => {
    const sales = { ingestPeriod: jest.fn().mockResolvedValue({ changed }) }
    const events = { publishPeriodDataUpdated: jest.fn().mockResolvedValue(undefined) }
    return { worker: new SalesRowsWorker(sales as never, events as never), sales, events }
  }

  const validJob = {
    schemaVersion: 1,
    ingestionId: 'ing-1',
    storeId: 7,
    period: '2026-03',
    rows: [{ sku: 'A', quantitySold: 2, revenueCents: 500 }],
  }

  it('ingests a well-formed batch', async () => {
    const { worker, sales } = build()

    await worker.process(jobFor(validJob))

    expect(sales.ingestPeriod).toHaveBeenCalledWith({
      storeId: 7,
      period: '2026-03',
      ingestionId: 'ing-1',
      rows: validJob.rows,
    })
  })

  it('rejects a payload version it does not understand instead of mis-reading it', async () => {
    const { worker, sales } = build()

    await expect(worker.process(jobFor({ ...validJob, schemaVersion: 2 }))).rejects.toThrow(/schemaVersion/)
    expect(sales.ingestPeriod).not.toHaveBeenCalled()
  })

  it('rejects a malformed period rather than writing under it', async () => {
    // A period like "March 2026" or "2026-3" must fail loudly — writing under a
    // wrong key silently attributes a month's figures to nothing.
    const { worker, sales } = build()

    await expect(worker.process(jobFor({ ...validJob, period: '2026-3' }))).rejects.toThrow(/period/)
    expect(sales.ingestPeriod).not.toHaveBeenCalled()
  })

  it('accepts an empty batch, which marks the period ingested with no rows', async () => {
    const { worker, sales } = build()

    await worker.process(jobFor({ ...validJob, rows: [] }))

    expect(sales.ingestPeriod).toHaveBeenCalledWith(expect.objectContaining({ rows: [] }))
  })
})

describe('SalesRowsWorker period event', () => {
  const build = (changed: boolean) => {
    const sales = { ingestPeriod: jest.fn().mockResolvedValue({ changed }) }
    const events = { publishPeriodDataUpdated: jest.fn().mockResolvedValue(undefined) }
    return { worker: new SalesRowsWorker(sales as never, events as never), events }
  }

  const job = {
    id: '1',
    data: {
      schemaVersion: 1,
      ingestionId: 'ing-1',
      correlationId: 'corr-1',
      storeId: 7,
      period: '2026-03',
      rows: [{ sku: 'A', quantitySold: 2, revenueCents: 500 }],
    },
  } as never

  it('publishes when sales actually changed', async () => {
    // Without this, inventory and finance keep serving a figure that no longer
    // matches the data — stock read 91 units after 40 had been sold, and
    // nothing indicated it. Found by running the full chain.
    const { worker, events } = build(true)

    await worker.process(job)

    expect(events.publishPeriodDataUpdated).toHaveBeenCalledWith(7, '2026-03', 'corr-1')
  })

  it('suppresses the event on a no-op re-delivery', async () => {
    const { worker, events } = build(false)

    await worker.process(job)

    expect(events.publishPeriodDataUpdated).not.toHaveBeenCalled()
  })
})

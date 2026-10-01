import { PERIOD_DATA_UPDATED_SUBSCRIBERS, PERIOD_EVENT_QUEUES } from '@app/period-events-contracts'
import { REFRESH_QUEUES } from './refresh.constants'
import { RefreshService } from './refresh.service'
import { PeriodUpdatedRefreshWorker } from './refresh.workers'

describe('the period event reaches intelligence-service', () => {
  it('has its own queue on the list the supply and sales publishers iterate (so neither publisher changes)', () => {
    expect(PERIOD_DATA_UPDATED_SUBSCRIBERS).toContain(PERIOD_EVENT_QUEUES.PERIOD_DATA_UPDATED_INTELLIGENCE)
    // Queues are point-to-point: sharing the inventory queue would split the events between the two services.
    expect(PERIOD_EVENT_QUEUES.PERIOD_DATA_UPDATED_INTELLIGENCE).not.toBe(PERIOD_EVENT_QUEUES.PERIOD_DATA_UPDATED_INVENTORY)
  })
})

describe('scheduleCheck — many events of one import collapse into one check', () => {
  const calls: { queueName: string; options: { jobId: string; delay: number } }[] = []
  const broker = { holdIt: async (call: { queueName: string; options: { jobId: string; delay: number } }) => void calls.push(call) }
  const config = { get: (key: string) => (key === 'REFRESH_DEBOUNCE_SECONDS' ? 60 : undefined) }
  const service = new RefreshService(null as never, null as never, null as never, null as never, broker as never, config as never, null as never)

  beforeEach(() => {
    calls.length = 0
  })

  it('events in the same window use the same job id, so the queue keeps one job', async () => {
    const t = Date.UTC(2026, 9, 5, 12, 0, 10)
    for (let i = 0; i < 200; i++) await service.scheduleCheck(undefined, t + i * 100)

    expect(new Set(calls.map(call => call.options.jobId)).size).toBe(1)
    expect(calls.every(call => call.queueName === REFRESH_QUEUES.CHECK)).toBe(true)
  })

  it('the check runs at the end of the window, after the burst', async () => {
    await service.scheduleCheck(undefined, Date.UTC(2026, 9, 5, 12, 0, 10))

    expect(calls[0].options.delay).toBe(50_000)
  })

  it('an event after the window (e.g. while the check is running) schedules the next check, so a late import is not lost', async () => {
    await service.scheduleCheck(undefined, Date.UTC(2026, 9, 5, 12, 0, 10))
    await service.scheduleCheck(undefined, Date.UTC(2026, 9, 5, 12, 1, 10))

    expect(calls[0].options.jobId).not.toBe(calls[1].options.jobId)
  })

  it('the event worker only schedules the check — it reads no source and decides nothing', async () => {
    const scheduled: unknown[] = []
    const worker = new PeriodUpdatedRefreshWorker({ scheduleCheck: async (id?: string) => void scheduled.push(id) } as never)

    await worker.process({ id: '1', data: { schemaVersion: 1, storeId: 1, period: '2026-09', source: 'sales', changedAt: new Date().toISOString(), correlationId: 'c1' } } as never)

    expect(scheduled).toEqual(['c1'])
    await expect(worker.process({ id: '2', data: { schemaVersion: 2 } } as never)).rejects.toThrow(/schemaVersion/)
  })
})

import type { DriveConfig } from '../config/drive.config'
import { DriveSchedulerService } from './drive-scheduler.service'

const config = (overrides: Partial<DriveConfig> = {}): DriveConfig => ({
  enabled: true,
  rootFolderId: 'root',
  credential: { kind: 'base64', value: 'x' },
  scanCron: '0 6 * * *',
  autoValidate: true,
  maxFileBytes: 25 * 1024 * 1024,
  includePatterns: ['relat[oó]rio'],
  syntheticPattern: 'sintetic',
  thresholds: { periodMatchMinShare: 0.9, weekdayOpenMinShare: 0.5, coverageMinPooled: 0.9, coverageMinStore: 0.7, edgeToleranceDays: 3 },
  ...overrides,
})

const build = (cfg: DriveConfig) => {
  const queue = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined), removeJobScheduler: jest.fn().mockResolvedValue(true) }
  const broker = { getQueue: jest.fn().mockResolvedValue(queue) }
  return { queue, broker, service: new DriveSchedulerService(cfg, broker as never) }
}

describe('DriveSchedulerService', () => {
  it('registers the daily scan at 06:00 in America/Sao_Paulo when the source is configured', async () => {
    const { service, queue } = build(config())

    await service.onApplicationBootstrap()

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1)
    const [id, repeat, template] = queue.upsertJobScheduler.mock.calls[0]
    expect(id).toBe('drive-scan')
    expect(repeat).toEqual({ pattern: '0 6 * * *', tz: 'America/Sao_Paulo' })
    expect(template).toMatchObject({ name: 'ingestion.drive-scan', data: { schemaVersion: 1, payload: { trigger: 'schedule' } } })
    expect(queue.removeJobScheduler).not.toHaveBeenCalled()
  })

  it('uses the configured cron', async () => {
    const { service, queue } = build(config({ scanCron: '30 5 * * 1-5' }))

    await service.onApplicationBootstrap()

    expect(queue.upsertJobScheduler.mock.calls[0][1]).toEqual({ pattern: '30 5 * * 1-5', tz: 'America/Sao_Paulo' })
  })

  it('always uses the same scheduler id, so a restart or a second replica updates one schedule instead of stacking another', async () => {
    const first = build(config())
    const second = build(config())

    await first.service.onApplicationBootstrap()
    await second.service.onApplicationBootstrap()

    expect(first.queue.upsertJobScheduler.mock.calls[0][0]).toBe(second.queue.upsertJobScheduler.mock.calls[0][0])
  })

  it('REMOVES the schedule when the source is not configured, so unsetting the variables really stops the scans', async () => {
    const { service, queue } = build(config({ enabled: false, rootFolderId: undefined, credential: undefined }))

    await service.onApplicationBootstrap()

    expect(queue.removeJobScheduler).toHaveBeenCalledWith('drive-scan')
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled()
  })

  it('does not take the service down when the schedule cannot be registered', async () => {
    const { service, queue } = build(config())
    queue.upsertJobScheduler.mockRejectedValue(new Error('redis unavailable'))

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined()
  })
})

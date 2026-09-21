import { DriveProducer } from './drive.producer'

const build = (inFlight: unknown[] = []) => {
  const queue = { getJobs: jest.fn().mockResolvedValue(inFlight) }
  const broker = { getQueue: jest.fn().mockResolvedValue(queue), holdIt: jest.fn().mockResolvedValue({}) }
  return { queue, broker, producer: new DriveProducer(broker as never) }
}

describe('DriveProducer', () => {
  describe('enqueueScan — two clicks on "Sincronizar agora" collapse into one run', () => {
    it('queues a scan when none is waiting or active', async () => {
      const { producer, broker } = build([])

      expect(await producer.enqueueScan({ trigger: 'manual' })).toBe('queued')
      expect(broker.holdIt).toHaveBeenCalledTimes(1)
      expect(broker.holdIt.mock.calls[0][0]).toMatchObject({
        queueName: 'ingestion.drive-scan',
        message: { schemaVersion: 1, payload: { trigger: 'manual' } },
      })
    })

    it('does not queue a second one while a scan is waiting or active', async () => {
      const { producer, broker } = build([{ id: 'running' }])

      expect(await producer.enqueueScan({ trigger: 'manual' })).toBe('already_running')
      expect(broker.holdIt).not.toHaveBeenCalled()
    })

    it('looks only at waiting and active jobs: the next scheduled scan sits in the queue as a delayed job and must not block a manual one', async () => {
      const { producer, queue } = build([])

      await producer.enqueueScan({ trigger: 'manual' })

      expect(queue.getJobs).toHaveBeenCalledWith(['waiting', 'active'])
    })

    it('does not deduplicate with a fixed jobId, which hold-it would keep for two hours and turn the button mute', async () => {
      const { producer, broker } = build([])

      await producer.enqueueScan({ trigger: 'manual' })

      expect(broker.holdIt.mock.calls[0][0].options.jobId).toBeUndefined()
    })
  })

  describe('enqueueValidation', () => {
    it('derives the job id from the file, so one file is validated once at a time', async () => {
      const { producer, broker } = build()

      await producer.enqueueValidation({ fileId: 'file-1' })

      expect(broker.holdIt.mock.calls[0][0]).toMatchObject({
        queueName: 'ingestion.drive-validate',
        options: { jobId: 'validate.file-1', removeOnComplete: true },
      })
    })

    it('carries a person\'s changed type and period through to the job', async () => {
      const { producer, broker } = build()

      await producer.enqueueValidation({ fileId: 'file-1', fileType: 'sales', period: '2026-08' })

      expect(broker.holdIt.mock.calls[0][0].message.payload).toEqual({ fileId: 'file-1', fileType: 'sales', period: '2026-08' })
    })
  })

  describe('enqueueImport', () => {
    it('queues the import on its own queue', async () => {
      const { producer, broker } = build()

      await producer.enqueueImport({ fileId: 'file-1' }, 'corr-1')

      expect(broker.holdIt.mock.calls[0][0]).toMatchObject({
        queueName: 'ingestion.drive-import',
        message: { payload: { fileId: 'file-1' }, correlationId: 'corr-1' },
      })
    })
  })
})

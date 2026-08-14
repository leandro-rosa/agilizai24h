import { HoldItBullMQBroker } from '@app/hold-it'
import { QUOTE_PROCESS_UPLOAD_QUEUE } from './quote-job-envelope'
import { ProcessUploadProducer } from './process-upload.producer'

describe('ProcessUploadProducer', () => {
  it('enqueues a versioned envelope with an idempotent jobId and retry options', async () => {
    const broker = { holdIt: jest.fn().mockResolvedValue(undefined) }
    const producer = new ProcessUploadProducer(broker as unknown as HoldItBullMQBroker)

    const envelope = await producer.enqueue(1, { sourceFileName: 'planilha.xlsx' })

    expect(envelope).toMatchObject({
      schemaVersion: 1,
      quoteId: 1,
      payload: { sourceFileName: 'planilha.xlsx' },
    })
    expect(broker.holdIt).toHaveBeenCalledWith({
      queueName: QUOTE_PROCESS_UPLOAD_QUEUE,
      message: envelope,
      options: {
        jobId: '1.process-upload',
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    })
  })
})

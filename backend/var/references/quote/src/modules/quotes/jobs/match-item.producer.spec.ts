import { HoldItBullMQBroker } from '@app/hold-it'
import { QUOTE_MATCH_ITEM_QUEUE } from './quote-job-envelope'
import { MatchItemProducer } from './match-item.producer'

describe('MatchItemProducer', () => {
  it('enqueues a versioned envelope with an idempotent jobId and retry options', async () => {
    const broker = { holdIt: jest.fn().mockResolvedValue(undefined) }
    const producer = new MatchItemProducer(broker as unknown as HoldItBullMQBroker)

    const envelope = await producer.enqueue(1, { itemId: 1 })

    expect(envelope).toMatchObject({
      schemaVersion: 1,
      quoteId: 1,
      payload: { itemId: 1 },
    })
    expect(broker.holdIt).toHaveBeenCalledWith({
      queueName: QUOTE_MATCH_ITEM_QUEUE,
      message: envelope,
      options: {
        jobId: '1.match-item.1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    })
  })

  it('includes revision in new preparation job ids', async () => {
    const broker = { holdIt: jest.fn().mockResolvedValue(undefined) }
    const producer = new MatchItemProducer(broker as unknown as HoldItBullMQBroker)

    await producer.enqueue(1, { itemId: 7, matchRevision: 4 })

    expect(broker.holdIt).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ jobId: '1.match-item.7.4' }),
    }))
  })

  it('enqueues bounded bulk chunks with retry options on every message', async () => {
    const broker = { holdIt: jest.fn(), holdItALot: jest.fn().mockResolvedValue([]) }
    const producer = new MatchItemProducer(broker as unknown as HoldItBullMQBroker)
    const payloads = Array.from({ length: 30 }, (_, index) => ({ itemId: index + 1, matchRevision: 4 }))

    await producer.enqueueMany(1, payloads, { attemptId: 'batch-abc' })

    expect(broker.holdIt).not.toHaveBeenCalled()
    expect(broker.holdItALot).toHaveBeenCalledTimes(2)
    expect(broker.holdItALot.mock.calls[0][0].messages).toHaveLength(25)
    expect(broker.holdItALot.mock.calls[1][0].messages).toHaveLength(5)
    expect(broker.holdItALot.mock.calls[0][0].messages[0]).toMatchObject({
      schemaVersion: 1,
      quoteId: 1,
      payload: { itemId: 1, matchRevision: 4 },
      jobOptions: {
        jobId: '1.match-item.1.4.batch-abc',
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    })
  })

  it('keeps bulk start jobs deterministic when no explicit reprocess attempt is given', async () => {
    const broker = { holdIt: jest.fn(), holdItALot: jest.fn().mockResolvedValue([]) }
    const producer = new MatchItemProducer(broker as unknown as HoldItBullMQBroker)

    await producer.enqueueMany(1, [{ itemId: 7, matchRevision: 4 }])

    expect(broker.holdItALot.mock.calls[0][0].messages[0].jobOptions.jobId).toBe('1.match-item.7.4')
  })
})

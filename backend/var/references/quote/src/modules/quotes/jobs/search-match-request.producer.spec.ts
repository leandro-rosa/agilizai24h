import { HoldItBullMQBroker } from '@app/hold-it'
import { SEARCH_MATCH_REQUEST_QUEUE } from '@app/quote-search-match'
import { SearchMatchRequestProducer } from './search-match-request.producer'

describe('SearchMatchRequestProducer', () => {
  const previousV2Flag = process.env.SEARCH_MATCH_V2_ENABLED

  afterEach(() => {
    if (previousV2Flag === undefined) delete process.env.SEARCH_MATCH_V2_ENABLED
    else process.env.SEARCH_MATCH_V2_ENABLED = previousV2Flag
  })

  it('enqueues a versioned envelope with an idempotent jobId and retry options', async () => {
    const broker = { holdIt: jest.fn().mockResolvedValue(undefined) }
    const producer = new SearchMatchRequestProducer(broker as unknown as HoldItBullMQBroker)

    const searchFields = [{ targetField: 'sku', value: 'OC90', priority: 0 }]
    await producer.enqueue(1, { itemId: 1, searchFields })

    expect(broker.holdIt).toHaveBeenCalledWith({
      queueName: SEARCH_MATCH_REQUEST_QUEUE,
      message: expect.objectContaining({
        schemaVersion: 1,
        quoteId: 1,
        payload: { itemId: 1, searchFields },
      }),
      options: {
        jobId: '1.search-match-request.1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    })
  })

  it('enqueues v2 with revision in envelope and job id', async () => {
    const broker = { holdIt: jest.fn().mockResolvedValue(undefined) }
    const producer = new SearchMatchRequestProducer(broker as unknown as HoldItBullMQBroker)
    const matchingConfig = {
      version: 1 as const,
      field_weights: { sku: 10, ean: 10, main_code: 9, oem: 8, trade_number: 8, name: 5, brand: 4 },
      synonyms: [],
      precision: 'balanced' as const,
      typo_tolerance: true,
      max_candidates: 5,
      minimum_score: 0,
      auto_approve: true,
      auto_approve_threshold: 80,
    }

    await producer.enqueueV2(1, {
      itemId: 7,
      matchRevision: 3,
      attemptId: 'attempt-abc',
      searchFields: [{ targetField: 'sku', value: 'OC90', priority: 0 }],
      matchingConfig,
    })

    expect(broker.holdIt).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({
        schemaVersion: 2,
        payload: expect.objectContaining({ attemptId: 'attempt-abc' }),
      }),
      options: expect.objectContaining({ jobId: '1.search-match-request.7.3.attempt-abc' }),
    }))
  })

  it('downgrades revision-zero requests to v1 when v2 emission is disabled', async () => {
    process.env.SEARCH_MATCH_V2_ENABLED = 'false'
    const broker = { holdIt: jest.fn().mockResolvedValue(undefined) }
    const producer = new SearchMatchRequestProducer(broker as unknown as HoldItBullMQBroker)
    const searchFields = [{ targetField: 'sku', value: 'OC90', priority: 0 }]

    await producer.enqueueV2(1, {
      itemId: 7,
      matchRevision: 0,
      searchFields,
      matchingConfig: {
        version: 1,
        field_weights: { sku: 10, ean: 10, main_code: 9, oem: 8, trade_number: 8, name: 5, brand: 4 },
        synonyms: [], precision: 'balanced', typo_tolerance: true, max_candidates: 5, minimum_score: 0,
        auto_approve: true, auto_approve_threshold: 80,
      },
    })

    expect(broker.holdIt).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({ schemaVersion: 1, payload: { itemId: 7, searchFields } }),
      options: expect.objectContaining({ jobId: '1.search-match-request.7' }),
    }))
  })

  it('refuses a lossy v1 downgrade after a matching revision exists', async () => {
    process.env.SEARCH_MATCH_V2_ENABLED = 'false'
    const broker = { holdIt: jest.fn().mockResolvedValue(undefined) }
    const producer = new SearchMatchRequestProducer(broker as unknown as HoldItBullMQBroker)

    await expect(producer.enqueueV2(1, {
      itemId: 7,
      matchRevision: 1,
      searchFields: [],
      matchingConfig: {
        version: 1,
        field_weights: { sku: 10, ean: 10, main_code: 9, oem: 8, trade_number: 8, name: 5, brand: 4 },
        synonyms: [], precision: 'balanced', typo_tolerance: true, max_candidates: 5, minimum_score: 0,
        auto_approve: true, auto_approve_threshold: 80,
      },
    })).rejects.toThrow(/revision zero/i)
    expect(broker.holdIt).not.toHaveBeenCalled()
  })
})

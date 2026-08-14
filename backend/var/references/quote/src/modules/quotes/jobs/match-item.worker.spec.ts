import { Job } from 'bullmq'
import { QuoteJobEnvelope } from './quote-job-envelope'
import { MatchItemPayload } from './match-item.producer'
import { MatchItemWorker } from './match-item.worker'

describe('MatchItemWorker', () => {
  let quoteRepository: { findUnique: jest.Mock }
  let quoteItemRepository: { findUnique: jest.Mock; update: jest.Mock }
  let columnMappingTemplateRepository: { findUnique: jest.Mock }
  let searchMatchRequestProducer: { enqueueV2: jest.Mock }
  let worker: MatchItemWorker

  beforeEach(() => {
    quoteRepository = { findUnique: jest.fn() }
    quoteItemRepository = { findUnique: jest.fn(), update: jest.fn() }
    columnMappingTemplateRepository = { findUnique: jest.fn() }
    searchMatchRequestProducer = { enqueueV2: jest.fn().mockResolvedValue(undefined) }
    worker = new MatchItemWorker(
      quoteRepository as any,
      quoteItemRepository as any,
      columnMappingTemplateRepository as any,
      searchMatchRequestProducer as any,
    )
  })

  function jobWith(envelope: unknown): Job<QuoteJobEnvelope<MatchItemPayload>> {
    return { data: envelope } as Job<QuoteJobEnvelope<MatchItemPayload>>
  }

  it('rejects a job carrying an unsupported schemaVersion instead of silently accepting it', async () => {
    const job = jobWith({
      schemaVersion: 2,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: { itemId: 1 },
    })

    await expect(worker.process(job)).rejects.toThrow(/Unsupported quote\.match-item schemaVersion: 2/)
    expect(quoteRepository.findUnique).not.toHaveBeenCalled()
  })

  it('logs and returns without querying Elasticsearch when the item no longer exists', async () => {
    quoteRepository.findUnique.mockResolvedValue({ id: 1 })
    quoteItemRepository.findUnique.mockResolvedValue(null)
    const job = jobWith({
      schemaVersion: 1,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: { itemId: 999 },
    })

    await expect(worker.process(job)).resolves.toBeUndefined()
    expect(searchMatchRequestProducer.enqueueV2).not.toHaveBeenCalled()
  })

  it('prepares mapped spreadsheet fields and delegates v2 without local catalog scoring', async () => {
    quoteRepository.findUnique.mockResolvedValue({
      id: 1,
      source: 'spreadsheet',
      column_mapping_id: 2,
      normalization_rules: ['trim', 'case'],
      matching_config: null,
      matching_config_revision: 3,
    })
    quoteItemRepository.findUnique.mockResolvedValue({ id: 1, quote_id: 1, raw_input: { Codigo: ' oc90 ' }, match_revision: 3 })
    columnMappingTemplateRepository.findUnique.mockResolvedValue({
      mappings: [{ spreadsheet_column: 'Codigo', target_field: 'sku', priority: 0, status: 'mapped' }],
    })
    const job = jobWith({
      schemaVersion: 1,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: { itemId: 1, matchRevision: 3 },
    })

    await worker.process(job)

    const searchFields = [{ targetField: 'sku', value: 'oc90', priority: 0 }]
    expect(quoteItemRepository.update).toHaveBeenCalledWith(1, { normalized_data: { sku: 'oc90' } })
    expect(searchMatchRequestProducer.enqueueV2).toHaveBeenCalledWith(1, expect.objectContaining({
      itemId: 1,
      matchRevision: 3,
      searchFields,
      matchingConfig: expect.objectContaining({ max_candidates: 5 }),
    }))
  })

  it('prepares partner fields with toSearchFields and skips spreadsheet mapping', async () => {
    quoteRepository.findUnique.mockResolvedValue({
      id: 1,
      source: 'partner_api',
      matching_config: null,
      matching_config_revision: 0,
    })
    quoteItemRepository.findUnique.mockResolvedValue({
      id: 1,
      quote_id: 1,
      raw_input: [{ key: 'ean', value: ' 789 ' }],
      match_revision: 0,
    })

    await worker.process(jobWith({
      schemaVersion: 1,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: { itemId: 1, matchRevision: 0 },
    }))

    expect(columnMappingTemplateRepository.findUnique).not.toHaveBeenCalled()
    expect(searchMatchRequestProducer.enqueueV2).toHaveBeenCalledWith(1, expect.objectContaining({
      searchFields: [{ targetField: 'ean', value: '789', priority: 0 }],
    }))
  })

  it('does nothing when payload revision differs from the current quote revision', async () => {
    quoteRepository.findUnique.mockResolvedValue({
      id: 1,
      source: 'partner_api',
      matching_config: null,
      matching_config_revision: 5,
    })
    quoteItemRepository.findUnique.mockResolvedValue({
      id: 1,
      quote_id: 1,
      raw_input: [{ key: 'sku', value: 'OC90' }],
      match_revision: 4,
      review_status: 'pending',
    })

    await worker.process(jobWith({
      schemaVersion: 1,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: { itemId: 1, matchRevision: 4 },
    }))

    expect(quoteItemRepository.update).not.toHaveBeenCalled()
    expect(searchMatchRequestProducer.enqueueV2).not.toHaveBeenCalled()
  })

  it('rejects an item belonging to another quote before writing or enqueueing', async () => {
    quoteRepository.findUnique.mockResolvedValue({ id: 1, source: 'partner_api', matching_config_revision: 0 })
    quoteItemRepository.findUnique.mockResolvedValue({
      id: 7,
      quote_id: 2,
      raw_input: [{ key: 'sku', value: 'OC90' }],
      review_status: 'pending',
      match_revision: 0,
    })

    await worker.process(jobWith({
      schemaVersion: 1,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: { itemId: 7, matchRevision: 0 },
    }))

    expect(quoteItemRepository.update).not.toHaveBeenCalled()
    expect(searchMatchRequestProducer.enqueueV2).not.toHaveBeenCalled()
  })

  it('throws for an invalid persisted config on a revision-aware job', async () => {
    quoteRepository.findUnique.mockResolvedValue({
      id: 1,
      source: 'partner_api',
      matching_config: { version: 99 },
      matching_config_revision: 2,
    })
    quoteItemRepository.findUnique.mockResolvedValue({
      id: 1,
      quote_id: 1,
      raw_input: [{ key: 'sku', value: 'OC90' }],
      match_revision: 2,
      review_status: 'pending',
    })

    await expect(worker.process(jobWith({
      schemaVersion: 1,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: { itemId: 1, matchRevision: 2 },
    }))).rejects.toThrow(/matching config/i)

    expect(searchMatchRequestProducer.enqueueV2).not.toHaveBeenCalled()
  })

  it('dedupes and limits prepared search fields at the worker boundary', async () => {
    quoteRepository.findUnique.mockResolvedValue({
      id: 1,
      source: 'partner_api',
      matching_config: null,
      matching_config_revision: 0,
    })
    quoteItemRepository.findUnique.mockResolvedValue({
      id: 1,
      quote_id: 1,
      raw_input: [
        { key: 'oem', value: 'OEM-A' },
        { key: 'oem', value: ' OEM-A ' },
        { key: 'oem', value: 'OEM-B' },
        ...Array.from({ length: 8 }, (_, index) => ({ key: 'sku', value: `SKU-${index}` })),
        { key: 'ean', value: 'x'.repeat(201) },
      ],
      match_revision: 0,
      review_status: 'pending',
    })

    await worker.process(jobWith({
      schemaVersion: 1,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: { itemId: 1, matchRevision: 0 },
    }))

    const payload = searchMatchRequestProducer.enqueueV2.mock.calls[0][1]
    expect(payload.searchFields).toHaveLength(7)
    expect(payload.searchFields.filter((field: { targetField: string }) => field.targetField === 'oem')).toEqual([
      { targetField: 'oem', value: 'OEM-A', priority: 2 },
      { targetField: 'oem', value: 'OEM-B', priority: 2 },
    ])
    expect(payload.searchFields.some((field: { value: string }) => field.value.length > 200)).toBe(false)
  })
})

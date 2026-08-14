import { Job } from 'bullmq'
import { SearchMatchJobEnvelope, SearchMatchResultPayload } from '@app/quote-search-match'
import { SearchMatchResultWorker } from './search-match-result.worker'

describe('SearchMatchResultWorker', () => {
  let transaction: {
    quoteItem: { findUnique: jest.Mock; updateMany: jest.Mock }
    quote: { findUnique: jest.Mock; update: jest.Mock }
    quoteActivityEvent: { create: jest.Mock }
    $executeRaw: jest.Mock
  }
  let prisma: { $transaction: jest.Mock }
  let worker: SearchMatchResultWorker

  beforeEach(() => {
    transaction = {
      quoteItem: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      quote: {
        findUnique: jest.fn().mockResolvedValue({ matching_config_revision: 0 }),
        update: jest.fn().mockResolvedValue({ status: 'awaiting_review', processed_rows: 1, reviewed_rows: 0, total_rows: 1 }),
      },
      quoteActivityEvent: { create: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
    }
    prisma = { $transaction: jest.fn(callback => callback(transaction)) }
    worker = new SearchMatchResultWorker(prisma as any)
  })

  function jobWith(envelope: unknown): Job<SearchMatchJobEnvelope<SearchMatchResultPayload>> {
    return { data: envelope } as Job<SearchMatchJobEnvelope<SearchMatchResultPayload>>
  }

  function itemWithFields(fields: Array<{ key: string; value: string }>) {
    return { id: 1, quote_id: 1, row_number: 1, raw_input: fields }
  }

  function envelopeWith(candidates: SearchMatchResultPayload['candidates']) {
    return {
      schemaVersion: 1,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: { itemId: 1, candidates },
    }
  }

  it('rejects a job carrying an unsupported schemaVersion instead of silently accepting it', async () => {
    const job = jobWith({
      schemaVersion: 3,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: { itemId: 1, candidates: [] },
    })

    await expect(worker.process(job)).rejects.toThrow(/Unsupported quote\.match-item-result schemaVersion: 3/)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('ignores a stale v2 result without writes or counter changes', async () => {
    transaction.quoteItem.findUnique.mockResolvedValue({ ...itemWithFields([]), match_revision: 5 })
    transaction.quote.findUnique.mockResolvedValue({ matching_config_revision: 5 })

    await worker.process(jobWith({
      schemaVersion: 2,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: {
        itemId: 1,
        matchRevision: 4,
        searchFields: [{ targetField: 'sku', value: 'OC90', priority: 0 }],
        matchingConfig: {
          version: 1,
          field_weights: { sku: 10, ean: 10, main_code: 9, oem: 8, trade_number: 8, name: 5, brand: 4 },
          synonyms: [], precision: 'balanced', typo_tolerance: true, max_candidates: 5, minimum_score: 0,
          auto_approve: true, auto_approve_threshold: 80,
        },
        candidates: [],
      },
    }))

    expect(transaction.quoteItem.updateMany).not.toHaveBeenCalled()
    expect(transaction.quote.update).not.toHaveBeenCalled()
  })

  it('ignores a result when the quote current revision no longer matches', async () => {
    transaction.quoteItem.findUnique.mockResolvedValue({ ...itemWithFields([]), match_revision: 4 })
    transaction.quote.findUnique.mockResolvedValue({ matching_config_revision: 5 })

    await worker.process(jobWith({
      schemaVersion: 2,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: {
        itemId: 1,
        matchRevision: 4,
        searchFields: [{ targetField: 'sku', value: 'OC90', priority: 0 }],
        matchingConfig: {
          version: 1,
          field_weights: { sku: 10, ean: 10, main_code: 9, oem: 8, trade_number: 8, name: 5, brand: 4 },
          synonyms: [], precision: 'balanced', typo_tolerance: true, max_candidates: 5, minimum_score: 0,
          auto_approve: true, auto_approve_threshold: 80,
        },
        candidates: [],
      },
    }))

    expect(transaction.quoteItem.updateMany).not.toHaveBeenCalled()
    expect(transaction.quote.update).not.toHaveBeenCalled()
  })

  it('throws on invalid v2 matching config instead of falling back to defaults', async () => {
    await expect(worker.process(jobWith({
      schemaVersion: 2,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: {
        itemId: 1,
        matchRevision: 4,
        searchFields: [],
        matchingConfig: { version: 99 },
        candidates: [],
      },
    }))).rejects.toThrow(/matching config/i)

    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects candidate payloads carrying non-allowlisted catalog fields', async () => {
    await expect(worker.process(jobWith({
      schemaVersion: 2,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: {
        itemId: 1,
        matchRevision: 0,
        searchFields: [{ targetField: 'sku', value: 'OC90', priority: 0 }],
        matchingConfig: {
          version: 1,
          field_weights: { sku: 10, ean: 10, main_code: 9, oem: 8, trade_number: 8, name: 5, brand: 4 },
          synonyms: [], precision: 'balanced', typo_tolerance: true, max_candidates: 5, minimum_score: 0,
          auto_approve: true, auto_approve_threshold: 80,
        },
        candidates: [{
          productId: 'p-1', name: 'Filtro', brand: '', sku: 'OC90', ean: '', mainCode: '', category: '', stock: 1,
          evidence: [], identifiers: { oem_codes: ['SECRET'] },
        }],
      },
    }))).rejects.toThrow(/candidate/i)

    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('uses v2 evidence/config, filters minimum score, and honors disabled auto approval', async () => {
    const matchingConfig = {
      version: 1,
      field_weights: { sku: 0, ean: 0, main_code: 0, oem: 10, trade_number: 0, name: 0, brand: 0 },
      synonyms: [], precision: 'balanced', typo_tolerance: true, max_candidates: 5, minimum_score: 90,
      auto_approve: false, auto_approve_threshold: 80,
    }
    transaction.quoteItem.findUnique.mockResolvedValue({
      ...itemWithFields([]),
      match_revision: 4,
      normalized_data: { oem: 'PROTECTED' },
    })
    transaction.quote.findUnique.mockResolvedValue({ matching_config_revision: 4, matching_config: matchingConfig })

    await worker.process(jobWith({
      schemaVersion: 2,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: {
        itemId: 1,
        matchRevision: 4,
        searchFields: [{ targetField: 'oem', value: 'PROTECTED', priority: 2 }],
        matchingConfig,
        candidates: [{
          productId: 'p-1', name: 'Filtro', brand: '', sku: '', ean: '', mainCode: '', category: '', stock: 1,
          evidence: [{ targetField: 'oem', kind: 'exact', searchFieldIndex: 0 }],
        }],
      },
    }))

    expect(transaction.quoteItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ match_revision: 4 }),
      data: expect.objectContaining({
        match_score: 100,
        match_reasons: ['OEM confirmado por evidência'],
      }),
    }))
    expect(transaction.quoteActivityEvent.create).not.toHaveBeenCalled()
  })

  it('rejects v2 scoring inputs that differ from the persisted request snapshot', async () => {
    const matchingConfig = {
      version: 1,
      field_weights: { sku: 10, ean: 10, main_code: 9, oem: 8, trade_number: 8, name: 5, brand: 4 },
      synonyms: [], precision: 'balanced', typo_tolerance: true, max_candidates: 5, minimum_score: 0,
      auto_approve: true, auto_approve_threshold: 80,
    }
    transaction.quote.findUnique.mockResolvedValue({ matching_config_revision: 4, matching_config: matchingConfig })
    transaction.quoteItem.findUnique.mockResolvedValue({
      ...itemWithFields([]),
      match_revision: 4,
      normalized_data: { sku: 'TRUSTED' },
    })

    await expect(worker.process(jobWith({
      schemaVersion: 2,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: {
        itemId: 1,
        matchRevision: 4,
        searchFields: [{ targetField: 'sku', value: 'TAMPERED', priority: 0 }],
        matchingConfig,
        candidates: [],
      },
    }))).rejects.toThrow(/persisted request snapshot/i)

    expect(transaction.quoteItem.updateMany).not.toHaveBeenCalled()
    expect(transaction.quote.update).not.toHaveBeenCalled()
  })

  it('rejects a v2 matching config that differs from the persisted revision', async () => {
    const persistedConfig = {
      version: 1,
      field_weights: { sku: 10, ean: 10, main_code: 9, oem: 8, trade_number: 8, name: 5, brand: 4 },
      synonyms: [], precision: 'balanced', typo_tolerance: true, max_candidates: 5, minimum_score: 0,
      auto_approve: true, auto_approve_threshold: 80,
    }
    transaction.quote.findUnique.mockResolvedValue({ matching_config_revision: 4, matching_config: persistedConfig })
    transaction.quoteItem.findUnique.mockResolvedValue({
      ...itemWithFields([]),
      match_revision: 4,
      normalized_data: { sku: 'OC90' },
    })

    await expect(worker.process(jobWith({
      schemaVersion: 2,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: {
        itemId: 1,
        matchRevision: 4,
        searchFields: [{ targetField: 'sku', value: 'OC90', priority: 0 }],
        matchingConfig: { ...persistedConfig, auto_approve_threshold: 0 },
        candidates: [],
      },
    }))).rejects.toThrow(/persisted matching config/i)

    expect(transaction.quoteItem.updateMany).not.toHaveBeenCalled()
    expect(transaction.quote.update).not.toHaveBeenCalled()
  })

  it('logs and returns without writing anything when the item no longer exists', async () => {
    transaction.quoteItem.findUnique.mockResolvedValue(null)

    await expect(worker.process(jobWith(envelopeWith([])))).resolves.toBeUndefined()

    expect(transaction.quoteItem.updateMany).not.toHaveBeenCalled()
    expect(transaction.quote.update).not.toHaveBeenCalled()
  })

  it('auto-approves and atomically advances counters when the best score is above 80', async () => {
    transaction.quoteItem.findUnique.mockResolvedValue(itemWithFields([{ key: 'sku', value: 'OC90' }]))
    transaction.quote.update.mockResolvedValueOnce({ status: 'awaiting_review', processed_rows: 1, reviewed_rows: 1, total_rows: 1 })
    const candidate = {
      productId: 'p-1',
      name: 'Filtro OC90',
      brand: 'Bosch',
      sku: 'OC90',
      ean: '',
      mainCode: '',
      category: '',
      stock: 1,
    }

    await worker.process(jobWith(envelopeWith([candidate])))

    expect(transaction.quoteItem.updateMany).toHaveBeenCalledWith({
      where: { id: 1, quote_id: 1, match_status: 'pending', review_status: 'pending', match_revision: 0 },
      data: expect.objectContaining({
        selected_candidate_id: 'p-1',
        review_status: 'reviewed',
        review_decision: 'approved',
        reviewed_by: 'system:auto-match',
      }),
    })
    expect(transaction.quote.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          processed_rows: { increment: 1 },
          matched_rows: { increment: 1 },
          reviewed_rows: { increment: 1 },
        }),
      }),
    )
    expect(transaction.quote.update).toHaveBeenNthCalledWith(2, {
      where: { id: 1 },
      data: { status: 'reviewed' },
    })
    expect(transaction.quoteActivityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quote_id: 1, kind: 'item_auto_matched' }),
    })
  })

  it('leaves the item pending for manual review when no candidate scores above 80', async () => {
    transaction.quoteItem.findUnique.mockResolvedValue(itemWithFields([{ key: 'name', value: 'Filtro de oleo' }]))
    const candidate = {
      productId: 'p-1',
      name: 'Filtro de oleo generico',
      brand: 'Outra Marca',
      sku: 'XX',
      ean: '',
      mainCode: '',
      category: '',
      stock: 1,
    }

    await worker.process(jobWith(envelopeWith([candidate])))

    const update = transaction.quoteItem.updateMany.mock.calls[0][0]
    expect(update.data.review_status).toBeUndefined()
    expect(update.data.selected_candidate_id).toBeUndefined()
    expect(transaction.quoteActivityEvent.create).not.toHaveBeenCalled()
    expect(transaction.quote.update).toHaveBeenCalledTimes(1)
  })

  it('marks matchStatus insufficient and advances only processed_rows without identifying fields', async () => {
    transaction.quoteItem.findUnique.mockResolvedValue(itemWithFields([]))

    await worker.process(jobWith(envelopeWith([])))

    expect(transaction.quoteItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ match_status: 'insufficient' }) }),
    )
    expect(transaction.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { processed_rows: { increment: 1 } } }),
    )
  })

  it('returns a reprocessed quote with reviewed items to partially reviewed when matching finishes', async () => {
    transaction.quoteItem.findUnique.mockResolvedValue(itemWithFields([{ key: 'sku', value: 'missing' }]))
    transaction.quote.update.mockResolvedValueOnce({ status: 'processing', processed_rows: 2, reviewed_rows: 1, total_rows: 2 })

    await worker.process(jobWith(envelopeWith([])))

    expect(transaction.quote.update).toHaveBeenNthCalledWith(2, {
      where: { id: 1 },
      data: { status: 'partially_reviewed' },
    })
  })

  it('does not increment counters or duplicate activity when BullMQ redelivers a processed item', async () => {
    transaction.quoteItem.findUnique.mockResolvedValue(itemWithFields([{ key: 'sku', value: 'OC90' }]))
    transaction.quote.update.mockResolvedValueOnce({ status: 'awaiting_review', processed_rows: 1, reviewed_rows: 1, total_rows: 1 })
    transaction.quoteItem.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
    const job = jobWith(
      envelopeWith([
        {
          productId: 'p-1',
          name: 'Filtro OC90',
          brand: 'Bosch',
          sku: 'OC90',
          ean: '',
          mainCode: '',
          category: '',
          stock: 1,
        },
      ]),
    )

    await worker.process(job)
    await worker.process(job)

    expect(transaction.quote.update).toHaveBeenCalledTimes(2)
    expect(transaction.quoteActivityEvent.create).toHaveBeenCalledTimes(1)
  })

  it('does not replace candidates when a manual decision wins the race', async () => {
    transaction.quoteItem.findUnique.mockResolvedValue(itemWithFields([{ key: 'sku', value: 'OC90' }]))
    transaction.quoteItem.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 })

    await worker.process(
      jobWith(
        envelopeWith([
          {
            productId: 'p-1',
            name: 'Filtro OC90',
            brand: 'Bosch',
            sku: 'OC90',
            ean: '',
            mainCode: '',
            category: '',
            stock: 1,
          },
        ]),
      ),
    )

    expect(transaction.quoteItem.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 1, quote_id: 1, match_status: 'pending', review_status: 'pending', match_revision: 0 },
        data: expect.not.objectContaining({ review_status: expect.anything() }),
      }),
    )
    expect(transaction.quote.update).not.toHaveBeenCalled()
    expect(transaction.quoteActivityEvent.create).not.toHaveBeenCalled()
  })

  it('takes a per-quote advisory transaction lock before result reads and writes', async () => {
    transaction.quoteItem.findUnique.mockResolvedValue(itemWithFields([]))

    await worker.process(jobWith(envelopeWith([])))

    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1)
    expect(transaction.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(transaction.quoteItem.findUnique.mock.invocationCallOrder[0])
  })
})

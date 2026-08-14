import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '../../db-client/generated/prisma/client'
import { QuotesService } from './quotes.service'

describe('QuotesService', () => {
  let service: QuotesService
  let quoteRepository: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; findAll: jest.Mock; count: jest.Mock }
  let quoteItemRepository: { findAll: jest.Mock; count: jest.Mock }
  let columnMappingTemplateRepository: { create: jest.Mock; findUnique: jest.Mock }
  let activityService: { record: jest.Mock }
  let processUploadProducer: { enqueue: jest.Mock }
  let matchItemProducer: { enqueue: jest.Mock; enqueueMany: jest.Mock }
  let s3Service: { uploadFile: jest.Mock }
  let transaction: {
    quote: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock }
    quoteItem: { count: jest.Mock; updateManyAndReturn: jest.Mock; findMany: jest.Mock }
    quoteActivityEvent: { create: jest.Mock }
    $executeRaw: jest.Mock
  }
  let prisma: { $transaction: jest.Mock }

  beforeEach(() => {
    quoteRepository = { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findAll: jest.fn(), count: jest.fn() }
    quoteItemRepository = { findAll: jest.fn(), count: jest.fn() }
    columnMappingTemplateRepository = { create: jest.fn(), findUnique: jest.fn() }
    activityService = { record: jest.fn() }
    processUploadProducer = { enqueue: jest.fn() }
    matchItemProducer = { enqueue: jest.fn(), enqueueMany: jest.fn().mockResolvedValue(undefined) }
    s3Service = { uploadFile: jest.fn() }
    transaction = {
      quote: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      quoteItem: { count: jest.fn(), updateManyAndReturn: jest.fn(), findMany: jest.fn() },
      quoteActivityEvent: { create: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
    }
    prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    }

    service = new QuotesService(
      quoteRepository as any,
      quoteItemRepository as any,
      columnMappingTemplateRepository as any,
      activityService as any,
      processUploadProducer as any,
      matchItemProducer as any,
      s3Service as any,
      prisma as never,
    )
  })

  describe('create', () => {
    it('defaults status to draft and source to spreadsheet when omitted', async () => {
      quoteRepository.create.mockResolvedValue({ id: 1, status: 'draft' })

      await service.create({ name: 'Cotação teste' })

      expect(quoteRepository.create).toHaveBeenCalledWith({
        name: 'Cotação teste',
        status: 'draft',
        source: 'spreadsheet',
        created_by: null,
      })
    })
  })

  describe('createFromUpload', () => {
    it('creates the quote, uploads the file to S3, and enqueues processing', async () => {
      quoteRepository.create.mockResolvedValue({ id: 1, status: 'uploading' })
      quoteRepository.update.mockResolvedValue({ id: 1, status: 'uploading', original_file_s3_key: 'quotes/1/original/planilha.xlsx' })

      const result = await service.createFromUpload('Cotação teste', 'user-1', {
        fileName: 'planilha.xlsx',
        fileSizeBytes: 1024,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from('fake'),
      })

      expect(quoteRepository.create).toHaveBeenCalledWith({
        name: 'Cotação teste',
        status: 'uploading',
        source: 'spreadsheet',
        created_by: 'user-1',
        original_file_name: 'planilha.xlsx',
        original_file_size_b: 1024,
      })
      expect(quoteRepository.update).toHaveBeenCalledWith(1, {
        original_file_s3_key: 'quotes/1/original/planilha.xlsx',
      })
      expect(s3Service.uploadFile).toHaveBeenCalledWith(
        'quotes/1/original/planilha.xlsx',
        expect.any(Buffer),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      expect(processUploadProducer.enqueue).toHaveBeenCalledWith(1, { sourceFileName: 'planilha.xlsx' })
      expect(activityService.record).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ id: 1, status: 'uploading', original_file_s3_key: 'quotes/1/original/planilha.xlsx' })
    })
  })

  describe('list', () => {
    it('uses the cursor and returns the cursor envelope', async () => {
      quoteRepository.findAll.mockResolvedValue([{ id: 2 }, { id: 1 }])

      const result = await service.list({ status: 'draft', created_by: 'user-1', cursor: 999, page_size: 1 })

      expect(quoteRepository.findAll).toHaveBeenCalledWith({
        where: { status: 'draft', created_by: 'user-1' },
        orderBy: { id: 'desc' },
        take: 2,
        cursor: { id: 999 },
        skip: 1,
      })
      expect(result).toEqual({ items: [{ id: 2 }], next_cursor: 2, page_size: 1 })
    })
  })

  describe('findById', () => {
    it('returns quote detail without embedding its unbounded items relation', async () => {
      const quote = { id: 1, status: 'draft', column_mapping: null }
      quoteRepository.findUnique.mockResolvedValue(quote)

      const result = await service.findById(1)

      expect(quoteRepository.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { column_mapping: true },
      })
      expect(result).toMatchObject(quote)
      expect(result).not.toHaveProperty('items')
    })

    it('throws NotFoundException when the quote does not exist', async () => {
      quoteRepository.findUnique.mockResolvedValue(null)

      await expect(service.findById(999)).rejects.toThrow(NotFoundException)
    })

    it('returns typed matching defaults for a legacy quote with null config', async () => {
      quoteRepository.findUnique.mockResolvedValue({
        id: 1,
        matching_config: null,
        matching_config_revision: 0,
      })

      const result = await service.findById(1)

      expect(result).toMatchObject({
        matching_config_revision: 0,
        matching_config: {
          version: 1,
          field_weights: { sku: 10, ean: 10, main_code: 9, oem: 8, trade_number: 8, name: 5, brand: 4 },
          synonyms: [],
          precision: 'balanced',
          typo_tolerance: true,
          max_candidates: 5,
          minimum_score: 0,
          auto_approve: true,
          auto_approve_threshold: 80,
        },
      })
    })

    it('falls back to typed defaults when persisted matching config is invalid', async () => {
      quoteRepository.findUnique.mockResolvedValue({
        id: 1,
        matching_config: { version: 99, arbitrary_query: { match_all: {} } },
        matching_config_revision: 2,
      })

      const result = await service.findById(1)

      expect(result.matching_config).toMatchObject({ version: 1, precision: 'balanced', max_candidates: 5 })
    })
  })

  describe('saveMatchingConfig', () => {
    it('persists the validated snapshot, increments revision, and records activity atomically', async () => {
      const matchingConfig = {
        version: 1 as const,
        field_weights: { sku: 10, ean: 10, main_code: 9, oem: 8, trade_number: 8, name: 6, brand: 4 },
        synonyms: [{ field: 'name' as const, terms: ['amortecedor', 'shock'] }],
        precision: 'strict' as const,
        typo_tolerance: false,
        max_candidates: 3,
        minimum_score: 40,
        auto_approve: true,
        auto_approve_threshold: 90,
      }
      transaction.quote.updateMany.mockResolvedValue({ count: 1 })
      transaction.quote.findUnique.mockResolvedValue({
        id: 1,
        matching_config: matchingConfig,
        matching_config_revision: 3,
      })

      const result = await service.saveMatchingConfig(1, matchingConfig, 2, 'reviewer-1')

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(transaction.$executeRaw).toHaveBeenCalledTimes(1)
      expect(transaction.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(transaction.quote.updateMany.mock.invocationCallOrder[0])
      expect(transaction.quote.updateMany).toHaveBeenCalledWith({
        where: { id: 1, matching_config_revision: 2 },
        data: {
          matching_config: matchingConfig,
          matching_config_revision: { increment: 1 },
        },
      })
      expect(transaction.quoteActivityEvent.create).toHaveBeenCalledWith({
        data: {
          quote_id: 1,
          kind: 'config_changed',
          message: 'Configuração de matching atualizada para revisão 3',
          actor: 'reviewer-1',
          metadata: { revision: 3 },
        },
      })
      expect(result).toMatchObject({ matching_config_revision: 3, matching_config: matchingConfig })
    })

    it('returns conflict and writes no activity when expected revision is stale', async () => {
      const matchingConfig = {
        version: 1 as const,
        field_weights: { sku: 10, ean: 10, main_code: 9, oem: 8, trade_number: 8, name: 6, brand: 4 },
        synonyms: [], precision: 'strict' as const, typo_tolerance: false, max_candidates: 3, minimum_score: 40,
        auto_approve: true, auto_approve_threshold: 90,
      }
      transaction.quote.updateMany.mockResolvedValue({ count: 0 })
      transaction.quote.findUnique.mockResolvedValue({ id: 1, matching_config_revision: 3 })

      await expect(service.saveMatchingConfig(1, matchingConfig, 2, 'reviewer-1')).rejects.toThrow(ConflictException)

      expect(transaction.quoteActivityEvent.create).not.toHaveBeenCalled()
    })
  })

  describe('reprocessPending', () => {
    it('resets only pending items, stamps revision, recomputes counters, and returns only public counts', async () => {
      transaction.quote.findUnique.mockResolvedValue({ id: 1, matching_config_revision: 4 })
      transaction.quoteItem.updateManyAndReturn.mockResolvedValue([
        {
          id: 10,
          quote_id: 1,
          row_number: 1,
          raw_input: [{ key: 'sku', value: 'ABC' }],
          normalized_data: null,
          candidates: [],
          match_score: null,
          match_reasons: [],
          match_status: 'pending',
          selected_candidate_id: null,
          review_status: 'pending',
          match_revision: 4,
        },
      ])
      transaction.quoteItem.findMany.mockResolvedValue([
        { id: 10, quote_id: 1, match_status: 'pending', review_status: 'pending', match_revision: 4 },
      ])
      transaction.quoteItem.count
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)

      const result = await service.reprocessPending(1, 'reviewer-1')

      expect(transaction.quoteItem.updateManyAndReturn).toHaveBeenCalledWith({
        where: { quote_id: 1, review_status: 'pending', match_revision: { lt: 4 } },
        data: {
          normalized_data: Prisma.DbNull,
          candidates: [],
          match_score: null,
          match_reasons: [],
          match_status: 'pending',
          selected_candidate_id: null,
          match_revision: 4,
        },
        select: { id: true },
      })
      expect(transaction.quoteItem.findMany).toHaveBeenCalledWith({
        where: {
          quote_id: 1,
          review_status: 'pending',
          match_status: 'pending',
          match_revision: 4,
        },
        select: { id: true },
      })
      expect(transaction.quote.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          status: 'processing',
          total_rows: 3,
          processed_rows: 1,
          reviewed_rows: 1,
          matched_rows: 1,
          unmatched_rows: 0,
          ambiguous_rows: 0,
          invalid_rows: 0,
          duplicate_rows: 0,
        },
      })
      expect(transaction.quoteActivityEvent.create).toHaveBeenCalledWith({
        data: {
          quote_id: 1,
          kind: 'pending_items_reprocessed',
          message: '1 item(ns) pendente(s) preparado(s) para reprocessamento na revisão 4',
          actor: 'reviewer-1',
          metadata: { revision: 4, item_count: 1 },
        },
      })
      expect(result).toEqual({
        matching_config_revision: 4,
        reprocessed_count: 1,
        enqueue_status: 'enqueued',
      })
      expect(result).not.toHaveProperty('eligible_items')
      expect(matchItemProducer.enqueueMany).toHaveBeenCalledWith(
        1,
        [{ itemId: 10, matchRevision: 4 }],
        { attemptId: expect.any(String) },
      )
      expect(transaction.$executeRaw).toHaveBeenCalledTimes(1)
      expect(transaction.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(transaction.quote.findUnique.mock.invocationCallOrder[0])
    })

    it('re-enqueues same-revision pending items without clearing processed results', async () => {
      transaction.quote.findUnique.mockResolvedValue({ id: 1, matching_config_revision: 4 })
      transaction.quoteItem.updateManyAndReturn.mockResolvedValue([])
      transaction.quoteItem.findMany.mockResolvedValue([
        { id: 11, quote_id: 1, match_status: 'pending', review_status: 'pending', match_revision: 4 },
      ])
      transaction.quoteItem.count.mockResolvedValue(0)

      await service.reprocessPending(1, 'reviewer-1')

      expect(transaction.quoteItem.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
        where: { quote_id: 1, review_status: 'pending', match_revision: { lt: 4 } },
        select: { id: true },
      }))
      expect(matchItemProducer.enqueueMany).toHaveBeenCalledWith(
        1,
        [{ itemId: 11, matchRevision: 4 }],
        { attemptId: expect.any(String) },
      )
    })

    it('returns conflict without changing counters when no pending item is eligible', async () => {
      transaction.quote.findUnique.mockResolvedValue({ id: 1, matching_config_revision: 4 })
      transaction.quoteItem.updateManyAndReturn.mockResolvedValue([])
      transaction.quoteItem.findMany.mockResolvedValue([])

      await expect(service.reprocessPending(1, 'reviewer-1')).rejects.toThrow(ConflictException)

      expect(transaction.quote.update).not.toHaveBeenCalled()
      expect(transaction.quoteActivityEvent.create).not.toHaveBeenCalled()
    })
  })

  describe('startProcessing', () => {
    it('requires a column mapping before starting', async () => {
      quoteRepository.findUnique.mockResolvedValue({ id: 1, status: 'draft', column_mapping_id: null })

      await expect(service.startProcessing(1, 'user-1')).rejects.toThrow(BadRequestException)
    })

    it('rejects starting from a non-draft status', async () => {
      quoteRepository.findUnique.mockResolvedValue({ id: 1, status: 'processing', column_mapping_id: 1 })

      await expect(service.startProcessing(1, 'user-1')).rejects.toThrow(ConflictException)
    })

    it('transitions to processing and enqueues one match job per item', async () => {
      quoteRepository.findUnique.mockResolvedValue({ id: 1, status: 'draft', column_mapping_id: 1, matching_config_revision: 2 })
      quoteItemRepository.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }])
      quoteRepository.update.mockResolvedValue({ id: 1, status: 'processing' })

      await service.startProcessing(1, 'user-1')

      expect(quoteRepository.update).toHaveBeenCalledWith(1, { status: 'processing' })
      expect(matchItemProducer.enqueueMany).toHaveBeenCalledWith(1, [
        { itemId: 1, matchRevision: 2 },
        { itemId: 2, matchRevision: 2 },
      ])
    })

    it('does not require spreadsheet mapping for a partner quote', async () => {
      quoteRepository.findUnique.mockResolvedValue({
        id: 1,
        source: 'partner_api',
        status: 'draft',
        column_mapping_id: null,
        matching_config_revision: 0,
      })
      quoteItemRepository.findAll.mockResolvedValue([{ id: 1 }])
      quoteRepository.update.mockResolvedValue({ id: 1, status: 'processing' })

      await expect(service.startProcessing(1, 'user-1')).resolves.toMatchObject({ status: 'processing' })
    })

    it('delegates bounded bulk enqueue to the producer', async () => {
      quoteRepository.findUnique.mockResolvedValue({
        id: 1,
        source: 'spreadsheet',
        status: 'draft',
        column_mapping_id: 1,
        matching_config_revision: 0,
      })
      quoteItemRepository.findAll.mockResolvedValue(Array.from({ length: 30 }, (_, index) => ({ id: index + 1 })))
      quoteRepository.update.mockResolvedValue({ id: 1, status: 'processing' })
      await service.startProcessing(1, 'user-1')

      expect(matchItemProducer.enqueueMany).toHaveBeenCalledWith(
        1,
        Array.from({ length: 30 }, (_, index) => ({ itemId: index + 1, matchRevision: 0 })),
      )
    })
  })

  describe('completeReview', () => {
    it('rejects completion while items are still pending', async () => {
      quoteRepository.findUnique.mockResolvedValue({ id: 1, status: 'awaiting_review' })
      quoteItemRepository.count.mockResolvedValue(2)

      await expect(service.completeReview(1, 'user-1')).rejects.toThrow(ConflictException)
    })

    it('completes the review once no items are pending', async () => {
      quoteRepository.findUnique.mockResolvedValue({ id: 1, status: 'awaiting_review' })
      quoteItemRepository.count.mockResolvedValue(0)
      quoteRepository.update.mockResolvedValue({ id: 1, status: 'completed' })

      const result = await service.completeReview(1, 'user-1')

      expect(quoteRepository.update).toHaveBeenCalledWith(1, { status: 'completed' })
      expect(result).toEqual({ id: 1, status: 'completed' })
    })
  })
})

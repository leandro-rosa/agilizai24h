import { BadRequestException, NotFoundException } from '@nestjs/common'
import { QuoteItemsService } from './quote-items.service'

describe('QuoteItemsService', () => {
  let quoteItemRepository: { findUnique: jest.Mock; update: jest.Mock; count: jest.Mock; findAll: jest.Mock }
  let quoteRepository: { findUnique: jest.Mock; update: jest.Mock }
  let activityService: { record: jest.Mock }
  let service: QuoteItemsService

  beforeEach(() => {
    quoteItemRepository = { findUnique: jest.fn(), update: jest.fn(), count: jest.fn(), findAll: jest.fn() }
    quoteRepository = { findUnique: jest.fn(), update: jest.fn() }
    activityService = { record: jest.fn() }
    service = new QuoteItemsService(quoteItemRepository as any, quoteRepository as any, activityService as any)
  })

  describe('listItems', () => {
    it('returns a cursor envelope', async () => {
      quoteItemRepository.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }])

      const result = await service.listItems(1, { cursor: 4, page_size: 2, pending_only: true } as any)

      expect(quoteItemRepository.findAll).toHaveBeenCalledWith({
        where: { quote_id: 1, review_status: 'pending' },
        orderBy: [{ row_number: 'asc' }, { id: 'asc' }],
        take: 3,
        cursor: { id: 4 },
        skip: 1,
      })
      expect(result).toEqual({ items: [{ id: 1 }, { id: 2 }], next_cursor: 2, page_size: 2 })
    })
  })

  describe('decideItem', () => {
    it('approves an item by referencing one of its existing candidates', async () => {
      quoteItemRepository.findUnique.mockResolvedValue({
        id: 1,
        quote_id: 1,
        row_number: 1,
        review_status: 'pending',
        candidates: [{ productId: 'p-1' }],
      })
      quoteItemRepository.update.mockResolvedValue({ id: 1, review_status: 'reviewed' })
      quoteItemRepository.count.mockResolvedValue(1)
      quoteRepository.findUnique.mockResolvedValue({ status: 'awaiting_review' })

      await service.decideItem(1, 1, { decision: 'approved', selected_candidate_id: 'p-1' } as any, 'reviewer-1')

      expect(quoteItemRepository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          review_status: 'reviewed',
          review_decision: 'approved',
          selected_candidate_id: 'p-1',
          reviewed_by: 'reviewer-1',
        }),
      )
    })

    it('rejects approving without a selected candidate', async () => {
      quoteItemRepository.findUnique.mockResolvedValue({ id: 1, quote_id: 1, candidates: [] })

      await expect(service.decideItem(1, 1, { decision: 'approved' } as any, null)).rejects.toThrow(BadRequestException)
    })

    it('rejects an item without requiring any candidate selection', async () => {
      quoteItemRepository.findUnique.mockResolvedValue({
        id: 1,
        quote_id: 1,
        row_number: 1,
        review_status: 'pending',
        candidates: [],
      })
      quoteItemRepository.update.mockResolvedValue({ id: 1 })
      quoteItemRepository.count.mockResolvedValue(1)
      quoteRepository.findUnique.mockResolvedValue({ status: 'awaiting_review' })

      await service.decideItem(1, 1, { decision: 'rejected' } as any, null)

      expect(quoteItemRepository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ review_decision: 'rejected', selected_candidate_id: null }),
      )
    })

    it('adds a manually-supplied candidate not already on the item and selects it', async () => {
      quoteItemRepository.findUnique.mockResolvedValue({
        id: 1,
        quote_id: 1,
        row_number: 1,
        review_status: 'pending',
        candidates: [{ productId: 'p-1' }],
      })
      quoteItemRepository.update.mockResolvedValue({ id: 1 })
      quoteItemRepository.count.mockResolvedValue(1)
      quoteRepository.findUnique.mockResolvedValue({ status: 'awaiting_review' })

      await service.decideItem(
        1,
        1,
        { decision: 'changed', selected_candidate: { productId: 'p-2' } } as any,
        null,
      )

      expect(quoteItemRepository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          selected_candidate_id: 'p-2',
          candidates: [{ productId: 'p-1' }, { productId: 'p-2' }],
        }),
      )
    })

    it('throws 404 when the item does not belong to the given quote', async () => {
      quoteItemRepository.findUnique.mockResolvedValue({ id: 1, quote_id: 2 })

      await expect(service.decideItem(1, 1, { decision: 'rejected' } as any, null)).rejects.toThrow(NotFoundException)
    })

    it('transitions the quote to reviewed once every item has been reviewed', async () => {
      quoteItemRepository.findUnique.mockResolvedValue({
        id: 2,
        quote_id: 1,
        row_number: 2,
        review_status: 'pending',
        candidates: [],
      })
      quoteItemRepository.update.mockResolvedValue({ id: 2 })
      quoteItemRepository.count.mockImplementation(async ({ where }: any) =>
        where.review_status === 'reviewed' ? 2 : 2,
      )
      quoteRepository.findUnique.mockResolvedValue({ status: 'partially_reviewed' })

      await service.decideItem(1, 2, { decision: 'rejected' } as any, null)

      expect(quoteRepository.update).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'reviewed' }))
    })

    it('does not recalculate quote progress when the item was already reviewed', async () => {
      quoteItemRepository.findUnique.mockResolvedValue({
        id: 1,
        quote_id: 1,
        review_status: 'reviewed',
        candidates: [],
      })
      quoteItemRepository.update.mockResolvedValue({ id: 1 })

      await service.decideItem(1, 1, { decision: 'rejected' } as any, null)

      expect(quoteItemRepository.count).not.toHaveBeenCalled()
      expect(quoteRepository.update).not.toHaveBeenCalled()
    })
  })

  describe('decideItemsBatch', () => {
    it('applies the same decision to every listed item sequentially', async () => {
      quoteItemRepository.findUnique
        .mockResolvedValueOnce({ id: 1, quote_id: 1, row_number: 1, review_status: 'pending', candidates: [] })
        .mockResolvedValueOnce({ id: 2, quote_id: 1, row_number: 2, review_status: 'pending', candidates: [] })
      quoteItemRepository.update.mockResolvedValue({})
      quoteItemRepository.count.mockResolvedValue(1)
      quoteRepository.findUnique.mockResolvedValue({ status: 'awaiting_review' })

      const results = await service.decideItemsBatch(1, [1, 2], 'ignored', undefined, null)

      expect(results).toHaveLength(2)
      expect(quoteItemRepository.update).toHaveBeenNthCalledWith(1, 1, expect.anything())
      expect(quoteItemRepository.update).toHaveBeenNthCalledWith(2, 2, expect.anything())
    })
  })
})

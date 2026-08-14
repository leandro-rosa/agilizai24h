import { BadRequestException, NotFoundException } from '@nestjs/common'
import { PartnerIntakeService } from './partner-intake.service'

describe('PartnerIntakeService', () => {
  let quoteRepository: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
  let quoteItemRepository: { create: jest.Mock; count: jest.Mock }
  let activityService: { record: jest.Mock }
  let matchItemProducer: { enqueue: jest.Mock; enqueueMany: jest.Mock }
  let transaction: {
    quote: { findUnique: jest.Mock; update: jest.Mock }
    quoteItem: { create: jest.Mock }
  }
  let prisma: { $transaction: jest.Mock }
  let service: PartnerIntakeService

  beforeEach(() => {
    quoteRepository = {
      create: jest.fn().mockResolvedValue({ id: 1 }),
      findUnique: jest.fn(),
      update: jest.fn(),
    }
    quoteItemRepository = {
      create: jest.fn().mockImplementation(async data => ({ id: data.row_number, ...data })),
      count: jest.fn().mockResolvedValue(0),
    }
    activityService = { record: jest.fn() }
    matchItemProducer = {
      enqueue: jest.fn().mockResolvedValue(undefined),
      enqueueMany: jest.fn().mockResolvedValue(undefined),
    }
    transaction = {
      quote: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ total_rows: 3 }),
      },
      quoteItem: {
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: data.row_number, ...data })),
      },
    }
    prisma = { $transaction: jest.fn(callback => callback(transaction)) }
    service = new PartnerIntakeService(
      quoteRepository as any,
      quoteItemRepository as any,
      activityService as any,
      matchItemProducer as any,
      prisma as any,
    )
  })

  describe('intake', () => {
    it('creates the quote and one pending item per line, without requiring pre-computed candidates', async () => {
      const dto = {
        displayName: 'Cotação Parceiro X',
        partnerName: 'Parceiro X',
        externalId: 'ext-1',
        lines: [{ originalFields: [{ key: 'sku', value: 'OC90' }] }],
      } as any

      await service.intake(dto, 'partner-actor')

      expect(quoteRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'partner_api', status: 'awaiting_review', total_rows: 1 }),
      )
      expect(quoteItemRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ quote_id: 1, match_status: 'pending', review_status: 'pending', candidates: [] }),
      )
      expect(quoteItemRepository.create).toHaveBeenCalledWith(expect.objectContaining({ match_revision: 0 }))
      expect(matchItemProducer.enqueueMany).toHaveBeenCalledWith(1, [{ itemId: 1, matchRevision: 0 }])
    })

    it('rejects a line with no recognized identifying field before creating anything', async () => {
      const dto = {
        displayName: 'Cotação Parceiro X',
        partnerName: 'Parceiro X',
        externalId: 'ext-1',
        lines: [{ originalFields: [{ key: 'notes', value: 'sem código' }] }],
      } as any

      await expect(service.intake(dto, null)).rejects.toThrow(BadRequestException)
      expect(quoteRepository.create).not.toHaveBeenCalled()
    })
  })

  describe('addItem', () => {
    it('adds an item to an existing partner-API quote and enqueues a match request', async () => {
      transaction.quote.findUnique.mockResolvedValue({ source: 'partner_api', matching_config_revision: 4 })

      const item = await service.addItem(1, { originalFields: [{ key: 'ean', value: '789' }] } as any, 'actor-1')

      expect(item).toMatchObject({ quote_id: 1, row_number: 3 })
      expect(transaction.quote.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { total_rows: { increment: 1 } },
        select: { total_rows: true },
      })
      expect(transaction.quoteItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ quote_id: 1, row_number: 3, match_status: 'pending' }),
      })
      expect(quoteItemRepository.count).not.toHaveBeenCalled()
      expect(transaction.quoteItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ match_revision: 4 }),
      })
      expect(matchItemProducer.enqueue).toHaveBeenCalledWith(1, { itemId: 3, matchRevision: 4 })
    })

    it('rejects adding an item to a non-existent quote', async () => {
      transaction.quote.findUnique.mockResolvedValue(null)

      await expect(
        service.addItem(999, { originalFields: [{ key: 'sku', value: 'X' }] } as any, null),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects adding an item to a spreadsheet-sourced quote', async () => {
      transaction.quote.findUnique.mockResolvedValue({ source: 'spreadsheet' })

      await expect(
        service.addItem(1, { originalFields: [{ key: 'sku', value: 'X' }] } as any, null),
      ).rejects.toThrow(BadRequestException)
      expect(transaction.quoteItem.create).not.toHaveBeenCalled()
    })

    it('rejects a line with no recognized identifying field', async () => {
      await expect(
        service.addItem(1, { originalFields: [{ key: 'notes', value: 'x' }] } as any, null),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })
})

import { BadRequestException } from '@nestjs/common'
import { QuotesController } from './quotes.controller'

describe('QuotesController', () => {
  let quotesService: any
  let quoteItemsService: any
  let quoteProductsService: any
  let quoteExportsService: any
  let activityService: any
  let partnerIntakeService: any
  let controller: QuotesController

  beforeEach(() => {
    quotesService = {
      createFromUpload: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      getStatus: jest.fn(),
      submitMapping: jest.fn(),
      saveMatchingConfig: jest.fn(),
      reprocessPending: jest.fn(),
      startProcessing: jest.fn(),
      completeReview: jest.fn(),
      getConfig: jest.fn(),
    }
    quoteItemsService = { listItems: jest.fn(), decideItem: jest.fn(), decideItemsBatch: jest.fn() }
    quoteProductsService = { search: jest.fn(), getByIds: jest.fn() }
    quoteExportsService = { createExport: jest.fn(), listExports: jest.fn(), getExport: jest.fn() }
    activityService = { listByQuote: jest.fn() }
    partnerIntakeService = { intake: jest.fn(), addItem: jest.fn() }

    controller = new QuotesController(
      quotesService,
      quoteItemsService,
      quoteProductsService,
      quoteExportsService,
      activityService,
      partnerIntakeService,
    )
  })

  it('delegates findById to QuotesService with the route param', async () => {
    quotesService.findById.mockResolvedValue({ id: 1, status: 'draft', items: [] })

    const result = await controller.findById(1)

    expect(quotesService.findById).toHaveBeenCalledWith(1)
    expect(result).toEqual({ id: 1, status: 'draft', items: [] })
  })

  it('delegates list to QuotesService with the query', async () => {
    const query = { status: 'draft', cursor: 999, page_size: 20 } as any
    quotesService.list.mockResolvedValue({ items: [], next_cursor: null, page_size: 20 })

    const result = await controller.list(query)

    expect(quotesService.list).toHaveBeenCalledWith(query)
    expect(result).toEqual({ items: [], next_cursor: null, page_size: 20 })
  })

  it('delegates decideItem to QuoteItemsService with quote id, item id, dto, and actor', async () => {
    const dto = { decision: 'approved', selected_candidate_id: 'p001' } as any
    await controller.decideItem(1, 2, dto, 'user-1')

    expect(quoteItemsService.decideItem).toHaveBeenCalledWith(1, 2, dto, 'user-1')
  })

  it('delegates partnerIntake to PartnerIntakeService with dto and actor', async () => {
    const dto = { displayName: 'X', partnerName: 'Y', externalId: 'EXT-1', lines: [] } as any
    await controller.partnerIntake(dto, 'user-1')

    expect(partnerIntakeService.intake).toHaveBeenCalledWith(dto, 'user-1')
  })

  it('forwards activity cursor pagination to QuoteActivityService', async () => {
    const query = { cursor: 50, page_size: 25 } as any
    activityService.listByQuote.mockResolvedValue({ items: [], next_cursor: null, page_size: 25 })

    const result = await controller.getActivity(1, query)

    expect(activityService.listByQuote).toHaveBeenCalledWith(1, query)
    expect(result).toEqual({ items: [], next_cursor: null, page_size: 25 })
  })

  it('delegates matching config updates with quote id and actor', async () => {
    const dto = {
      expected_revision: 2,
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

    await controller.saveMatchingConfig(1, dto, 'reviewer-1')

    expect(quotesService.saveMatchingConfig).toHaveBeenCalledWith(
      1,
      expect.not.objectContaining({ expected_revision: expect.anything() }),
      2,
      'reviewer-1',
    )
  })

  it('delegates pending reprocessing with quote id and actor', async () => {
    await controller.reprocessPending(1, 'reviewer-1')

    expect(quotesService.reprocessPending).toHaveBeenCalledWith(1, 'reviewer-1')
  })

  describe('create (multipart upload)', () => {
    function fakeRequest(parts: Array<Record<string, unknown>>) {
      return {
        parts: () => ({
          [Symbol.asyncIterator]: async function* () {
            for (const part of parts) yield part
          },
        }),
      }
    }

    it('rejects when the "name" field is missing', async () => {
      const request = fakeRequest([
        { type: 'file', fieldname: 'file', filename: 'a.xlsx', mimetype: 'application/xlsx', toBuffer: async () => Buffer.from('x') },
      ])

      await expect(controller.create(request as any, 'user-1')).rejects.toThrow(BadRequestException)
    })

    it('rejects when the file part is missing', async () => {
      const request = fakeRequest([{ type: 'field', fieldname: 'name', value: 'Cotação teste' }])

      await expect(controller.create(request as any, 'user-1')).rejects.toThrow(BadRequestException)
    })

    it('delegates to QuotesService.createFromUpload once name and file are both present', async () => {
      const request = fakeRequest([
        { type: 'field', fieldname: 'name', value: 'Cotação teste' },
        {
          type: 'file',
          fieldname: 'file',
          filename: 'planilha.xlsx',
          mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          toBuffer: async () => Buffer.from('conteudo'),
        },
      ])
      quotesService.createFromUpload.mockResolvedValue({ id: 1 })

      const result = await controller.create(request as any, 'user-1')

      expect(quotesService.createFromUpload).toHaveBeenCalledWith(
        'Cotação teste',
        'user-1',
        expect.objectContaining({ fileName: 'planilha.xlsx', fileSizeBytes: 8 }),
      )
      expect(result).toEqual({ id: 1 })
    })
  })
})

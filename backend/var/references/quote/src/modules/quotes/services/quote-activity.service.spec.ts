import { QuoteActivityService } from './quote-activity.service'

describe('QuoteActivityService', () => {
  let activityRepository: { create: jest.Mock; findAll: jest.Mock }
  let service: QuoteActivityService

  beforeEach(() => {
    activityRepository = { create: jest.fn(), findAll: jest.fn() }
    service = new QuoteActivityService(activityRepository as any)
  })

  it('returns newest-first activity in a cursor envelope', async () => {
    activityRepository.findAll.mockResolvedValue([{ id: 30 }, { id: 29 }, { id: 28 }])

    const result = await service.listByQuote(7, { cursor: 40, page_size: 2 })

    expect(activityRepository.findAll).toHaveBeenCalledWith({
      where: { quote_id: 7 },
      orderBy: { id: 'desc' },
      take: 3,
      cursor: { id: 40 },
      skip: 1,
    })
    expect(result).toEqual({ items: [{ id: 30 }, { id: 29 }], next_cursor: 29, page_size: 2 })
  })

  it('defaults page_size to 20 and returns null when no next page exists', async () => {
    activityRepository.findAll.mockResolvedValue([{ id: 1 }])

    const result = await service.listByQuote(7, {})

    expect(activityRepository.findAll).toHaveBeenCalledWith({
      where: { quote_id: 7 },
      orderBy: { id: 'desc' },
      take: 21,
    })
    expect(result).toEqual({ items: [{ id: 1 }], next_cursor: null, page_size: 20 })
  })
})

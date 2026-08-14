import { SearchCatalogService } from './search-catalog.service'

describe('SearchCatalogService', () => {
  let httpClient: { send: jest.Mock }
  let configService: { get: jest.Mock }
  let service: SearchCatalogService

  beforeEach(() => {
    httpClient = { send: jest.fn() }
    configService = { get: jest.fn().mockReturnValue('http://search-api:3000') }
    service = new SearchCatalogService(httpClient as any, configService as any)
  })

  it('returns an empty array without calling the HTTP client for an empty id list', async () => {
    const result = await service.getProductsByIds([])

    expect(result).toEqual([])
    expect(httpClient.send).not.toHaveBeenCalled()
  })

  it('dedupes ids before requesting', async () => {
    httpClient.send.mockResolvedValue({ response: { data: { items: [{ id: 1 }] } } })

    await service.getProductsByIds(['1', '1', '2'])

    expect(httpClient.send).toHaveBeenCalledTimes(1)
    const call = httpClient.send.mock.calls[0][0]
    expect(call.url).toContain('ids=1,2')
  })

  it('chunks requests at 50 ids per call', async () => {
    httpClient.send.mockResolvedValue({ response: { data: { items: [] } } })
    const ids = Array.from({ length: 120 }, (_, i) => String(i))

    await service.getProductsByIds(ids)

    expect(httpClient.send).toHaveBeenCalledTimes(3)
  })

  it('merges items across chunks', async () => {
    httpClient.send
      .mockResolvedValueOnce({ response: { data: { items: [{ id: 1 }] } } })
      .mockResolvedValueOnce({ response: { data: { items: [{ id: 2 }] } } })
    const ids = Array.from({ length: 60 }, (_, i) => String(i))

    const result = await service.getProductsByIds(ids)

    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('omits a failed chunk instead of throwing, so callers can fall back per item', async () => {
    httpClient.send.mockRejectedValue(new Error('search-api unreachable'))

    const result = await service.getProductsByIds(['1', '2'])

    expect(result).toEqual([])
  })

  it('always passes an explicit timeout (no reliance on the http client default)', async () => {
    httpClient.send.mockResolvedValue({ response: { data: { items: [] } } })

    await service.getProductsByIds(['1'])

    expect(httpClient.send).toHaveBeenCalledWith(expect.objectContaining({ timeout: expect.any(Number) }))
  })
})

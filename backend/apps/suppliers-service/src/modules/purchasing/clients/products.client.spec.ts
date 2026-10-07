import { ProductsClient } from './products.client'

/** The REAL client with `fetch` stubbed: the cache is exactly what the unit and integration fakes could not exercise. */
function make(catalogues: { sku: string }[][]) {
  const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => catalogues[Math.min(fetchMock.mock.calls.length - 1, catalogues.length - 1)] }))
  global.fetch = fetchMock as never

  return { client: new ProductsClient({ getOrThrow: () => 'http://products' } as never), fetchMock }
}

describe('ProductsClient.existingSkus', () => {
  afterEach(() => jest.restoreAllMocks())

  it('a product registered after the catalogue was cached is found: the catalogue is read again once before the SKU is called unknown', async () => {
    const { client, fetchMock } = make([[{ sku: 'Q1' }], [{ sku: 'Q1' }, { sku: '110024' }]])

    await client.products() // the invoice preview warms the one-minute cache
    const known = await client.existingSkus(['110024'])

    expect(known.has('110024')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a SKU that really does not exist is still unknown, after exactly one more read', async () => {
    const { client, fetchMock } = make([[{ sku: 'Q1' }]])

    const known = await client.existingSkus(['NAO-EXISTE'])

    expect(known.has('NAO-EXISTE')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('when every wanted SKU is already known the cache is used and nothing is read again', async () => {
    const { client, fetchMock } = make([[{ sku: 'Q1' }, { sku: 'Q2' }]])

    await client.products()
    const known = await client.existingSkus(['Q1', 'Q2'])

    expect(known.size).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

import { PricingController } from './pricing.controller'

const request = { headers: {} } as never

function build() {
  const intelligence = jest.fn(async (_options: { method: string; path: string }) => ({ data: { ok: true } }))
  const controller = new PricingController({ intelligence } as never, {} as never)

  return { controller, intelligence }
}

describe('PricingController — the current basis', () => {
  it('without a store the query is empty: the network, never the text "undefined"', async () => {
    const { controller, intelligence } = build()
    await controller.current({}, request)

    expect(intelligence.mock.calls[0][0]).toMatchObject({ method: 'get', path: '/pricing/current' })
  })

  it('with a store the store goes through', async () => {
    const { controller, intelligence } = build()
    await controller.current({ storeId: '3' }, request)

    expect(intelligence.mock.calls[0][0].path).toBe('/pricing/current?storeId=3')
  })

  it('the per-product simulation and stores go to the current-basis routes of the engine', async () => {
    const { controller, intelligence } = build()
    await controller.simulateCurrent('100103', { priceCents: 1190 }, request)
    await controller.currentStores('100103', request)

    expect(intelligence.mock.calls.map(call => `${call[0].method} ${call[0].path}`)).toEqual(['post /pricing/current/100103/simulate', 'get /pricing/current/100103/stores'])
  })
})

import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import { UpstreamClient } from './upstream.client'

describe('UpstreamClient', () => {
  function buildClient(send: jest.Mock) {
    const http = { send } as unknown as AxiosHttpClient
    const config = {
      getOrThrow: (key: string) =>
        ({
          STORES_SERVICE_URL: 'http://stores',
          SALES_SERVICE_URL: 'http://sales',
          FINANCE_SERVICE_URL: 'http://finance',
          TREASURY_SERVICE_URL: 'http://treasury',
        })[key],
    } as unknown as ConfigService
    return new UpstreamClient(http, config)
  }

  it('returns 0 revenue when sales-service 404s — never throws, never fabricates a non-zero number', async () => {
    const send = jest.fn().mockRejectedValue({ response: { status: 404 } })
    const client = buildClient(send)

    const revenue = await client.salesRevenueCents(7, '2026-09')

    expect(revenue).toBe(0)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://sales/sales/7/totals?period=2026-09' }),
    )
  })

  it('returns the real revenue field from sales-service totals', async () => {
    const send = jest.fn().mockResolvedValue({ response: { data: { total_revenue_cents: 123456 } } })
    const client = buildClient(send)

    expect(await client.salesRevenueCents(7, '2026-09')).toBe(123456)
  })

  it('returns null from finance-service on 404 — distinct from a real zero reconciliation', async () => {
    const send = jest.fn().mockRejectedValue({ response: { status: 404 } })
    const client = buildClient(send)

    expect(await client.financeFor(7, '2026-09')).toBeNull()
  })

  it('re-throws a non-404 error — a transport failure must not look like "no data"', async () => {
    const send = jest.fn().mockRejectedValue({ response: { status: 503 } })
    const client = buildClient(send)

    await expect(client.salesRevenueCents(7, '2026-09')).rejects.toBeTruthy()
  })

  it('sums treasury categories as |inflow - outflow|, skipping movement/pending and neutralized rows', async () => {
    const send = jest.fn().mockResolvedValue({
      response: {
        data: [
          { kind: 'expense', direction: 'outflow', amount_cents: 10000, category: 'Luz', neutralized_with_id: null },
          { kind: 'revenue', direction: 'inflow', amount_cents: 50000, category: 'Receita - Mensalidade', neutralized_with_id: null },
          { kind: 'movement', direction: 'outflow', amount_cents: 99999, category: 'Movimentação entre contas', neutralized_with_id: null },
          { kind: 'expense', direction: 'outflow', amount_cents: 500, category: 'Luz', neutralized_with_id: 3 },
        ],
      },
    })
    const client = buildClient(send)

    const totals = await client.treasuryCategoryTotals('2026-09')

    expect(totals.get('Luz')).toBe(10000)
    expect(totals.get('Receita - Mensalidade')).toBe(50000)
    expect(totals.has('Movimentação entre contas')).toBe(false)
  })

  it('lists only active stores', async () => {
    const send = jest.fn().mockResolvedValue({
      response: {
        data: [
          { id: 1, name: 'A', status: 'active' },
          { id: 2, name: 'B', status: 'inactive' },
        ],
      },
    })
    const client = buildClient(send)

    expect(await client.activeStores()).toEqual([{ id: 1, name: 'A' }])
  })
})

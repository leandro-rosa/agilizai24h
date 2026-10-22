import { BadRequestException } from '@nestjs/common'
import { ClientDivergenceReportService } from './client-divergence-report.service'

/** Fictitious data only: a made-up client, units, products and prices. */
const CLIENT = { id: 9, name: 'Cliente Fictício', sites: [{ code: 'SP02', store_id: 2 }, { code: 'SP01', store_id: 1 }, { code: 'SEM-LOJA', store_id: null }] }

const divergence = (over: Record<string, unknown> = {}) => ({
  store_id: 1,
  sku: 'COLA',
  quantity: 5,
  identified_at: '2026-05-07T10:00:00.000Z',
  identified_kind: 'inventory',
  previous_conference_at: '2026-05-04T09:00:00.000Z',
  previous_conference_kind: 'combined',
  identified_source: { visit_id: 2, sheet: 'Operação 2' },
  previous_conference_source: { visit_id: 1, sheet: 'Operação 1' },
  ...over,
})

function build(options: { divergences?: any[]; prices?: Record<string, Array<{ sku: string; price_cents: number }>>; unsplit?: number } = {}) {
  const calls: Array<{ service: string; path: string; payload?: any }> = []
  const domains = {
    billing: async (call: any) => {
      calls.push({ service: 'billing', path: call.path })
      return { data: CLIENT }
    },
    supply: async (call: any) => {
      calls.push({ service: 'supply', path: call.path })
      return { data: { divergences: options.divergences ?? [], unsplit_visits: options.unsplit ?? 0 } }
    },
    products: async (call: any) => {
      calls.push({ service: 'products', path: call.path, payload: call.payload })
      if (call.path === '/products') return { data: [{ sku: 'COLA', name: 'Cola 350 ml' }, { sku: 'ENERGY', name: 'Energético 473 ml' }] }
      const resolved = (options.prices?.[call.payload.as_of] ?? []).filter(price => call.payload.skus.includes(price.sku)).map(price => ({ ...price, effective_from: '2026-01-01' }))

      return { data: { resolved, unresolved: [], complete: true } }
    },
  }

  return { service: new ClientDivergenceReportService(domains as never), calls }
}

const ask = (service: ClientDivergenceReportService, over: Record<string, unknown> = {}) => service.build({ clientId: 9, from: '2026-05-01', to: '2026-05-11', ...over } as never)

describe('ClientDivergenceReportService (fictitious data)', () => {
  it('values at the price in force on the identification day and keeps history when the price changes later', async () => {
    const { service } = build({
      divergences: [divergence(), divergence({ identified_at: '2026-05-10T10:00:00.000Z', quantity: 2, previous_conference_at: '2026-05-07T10:00:00.000Z' })],
      // R$ 6,00 until the 8th, R$ 7,50 afterwards: the first occurrence must keep 6,00.
      prices: { '2026-05-07': [{ sku: 'COLA', price_cents: 600 }], '2026-05-10': [{ sku: 'COLA', price_cents: 750 }] },
    })

    const report = await ask(service)
    const rows = report.units[0].rows

    expect(rows.map(r => [r.quantity, r.unit_price_cents, r.loss_cents])).toEqual([[5, 600, 3000], [2, 750, 1500]])
    expect(report.totals).toMatchObject({ quantity: 7, loss_cents: 4500, distinct_products: 1, unpriced_rows: 0, partial: false })
  })

  it('shows an unknown price as null and marks the unit and the total as partial — never zero, never today\'s price', async () => {
    const { service } = build({
      divergences: [divergence(), divergence({ sku: 'ENERGY', quantity: 3 })],
      prices: { '2026-05-07': [{ sku: 'COLA', price_cents: 600 }] },
    })

    const report = await ask(service)
    const energy = report.units[0].rows.find(row => row.sku === 'ENERGY')!

    expect(energy).toMatchObject({ unit_price_cents: null, loss_cents: null })
    expect(report.units[0]).toMatchObject({ unpriced_rows: 1, partial: true, total_loss_cents: 3000, total_quantity: 8 })
    expect(report.totals).toMatchObject({ partial: true, unpriced_rows: 1, loss_cents: 3000 })
  })

  it('orders each unit by quantity, largest first, then by identification instant and product name', async () => {
    const { service } = build({
      divergences: [
        divergence({ sku: 'COLA', quantity: 2 }),
        divergence({ sku: 'ENERGY', quantity: 9 }),
        divergence({ sku: 'ENERGY', quantity: 2, identified_at: '2026-05-06T10:00:00.000Z' }),
        divergence({ sku: 'COLA', quantity: 5, store_id: 2 }),
        divergence({ sku: 'ENERGY', quantity: 7, store_id: 2 }),
      ],
    })

    const units = (await ask(service)).units

    expect(units[0].rows.map(r => [r.quantity, r.product_name, r.identified_at.slice(5, 10)])).toEqual([[9, 'Energético 473 ml', '05-07'], [2, 'Energético 473 ml', '05-06'], [2, 'Cola 350 ml', '05-07']])
    expect(units[1].rows.map(r => r.quantity)).toEqual([7, 5])
  })

  it('refuses a store that is not a unit of the client, so a client never sees another one', async () => {
    const { service, calls } = build()

    await expect(ask(service, { storeIds: [1, 77] })).rejects.toBeInstanceOf(BadRequestException)
    expect(calls.some(call => call.service === 'supply')).toBe(false)
  })

  it('defaults to every unit of the client, ordered by unit code, ignoring a site with no store', async () => {
    const { service, calls } = build({ divergences: [divergence({ store_id: 2, sku: 'ENERGY' }), divergence()] })

    const report = await ask(service)

    expect(calls.find(call => call.service === 'supply')!.path).toContain('store_ids=2,1')
    expect(report.units.map(unit => unit.code)).toEqual(['SP01', 'SP02'])
  })

  it('returns units with no rows and no price calls when there are no divergences', async () => {
    const { service, calls } = build({ unsplit: 3 })

    const report = await ask(service, { storeIds: [1] })

    expect(report.units).toEqual([expect.objectContaining({ rows: [], total_quantity: 0, partial: false })])
    expect(report.totals.rows).toBe(0)
    expect(report.unsplit_visits).toBe(3)
    expect(calls.some(call => call.service === 'products')).toBe(false)
  })

  it('rejects an invalid or inverted period', async () => {
    const { service } = build()

    await expect(ask(service, { from: '2026-05-12', to: '2026-05-11' })).rejects.toBeInstanceOf(BadRequestException)
    await expect(ask(service, { from: '2026-02-30' })).rejects.toBeInstanceOf(BadRequestException)
  })
})

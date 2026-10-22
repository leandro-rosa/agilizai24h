import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { DomainClient } from '../upstream/domain.client'

interface BillingSite {
  code: string
  store_id: number | null
}

interface BillingClient {
  id: number
  name: string
  sites: BillingSite[]
}

interface SupplyDivergence {
  store_id: number
  sku: string
  quantity: number
  identified_at: string
  identified_kind: string
  previous_conference_at: string | null
  previous_conference_kind: string | null
  identified_source: { visit_id: number; sheet: string }
  previous_conference_source: { visit_id: number; sheet: string } | null
}

interface SupplyDivergences {
  divergences: SupplyDivergence[]
  unsplit_visits: number
}

interface BulkPrice {
  resolved: Array<{ sku: string; price_cents: number; effective_from: string }>
  unresolved: Array<{ sku: string; reason: string }>
}

export interface ClientDivergenceRow {
  sku: string
  product_name: string
  quantity: number
  /** Report instants (wall-clock in UTC fields). `previous_conference_at` is null when the product has no earlier count. */
  previous_conference_at: string | null
  identified_at: string
  /** Sale price in force on the identification day; null = no sale price registered on or before it (never zero, never today's). */
  unit_price_cents: number | null
  /** quantity × unit price, in centavos; null when the price is unknown. */
  loss_cents: number | null
  /** Internal trace to the report sheets the dates came from. */
  source: { identified: { visit_id: number; sheet: string; kind: string }; previous: { visit_id: number; sheet: string; kind: string } | null }
}

export interface ClientDivergenceUnit {
  store_id: number
  code: string
  rows: ClientDivergenceRow[]
  total_quantity: number
  /** Sum of the rows whose price is known. */
  total_loss_cents: number
  unpriced_rows: number
  partial: boolean
}

export interface ClientDivergenceReport {
  client: { id: number; name: string }
  from: string
  to: string
  units: ClientDivergenceUnit[]
  totals: { quantity: number; loss_cents: number; distinct_products: number; rows: number; unpriced_rows: number; partial: boolean }
  /** Visits in the range with removals whose reasons were never stored: the report is incomplete for them until the month is re-imported. */
  unsplit_visits: number
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const isDay = (value: unknown): value is string => typeof value === 'string' && DAY.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

/** Runs `work` over `items` with at most `limit` in flight. */
async function inBatches<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let index = 0; index < items.length; index += limit) {
    results.push(...(await Promise.all(items.slice(index, index + limit).map(work))))
  }

  return results
}

/**
 * The client divergence report: supply's per-visit occurrences of the one reason, named, dated and valued at the sale
 * price IN FORCE ON THE IDENTIFICATION DAY (products-service dated, append-only price versions), grouped per unit of
 * the client. The unit list comes from the client's billing sites, never from names; a store id that is not one of the
 * client's units is refused, so one client can never read another's stores.
 *
 * Read-only. The screen, the PDF and the Excel all render THIS payload, so they cannot disagree.
 */
@Injectable()
export class ClientDivergenceReportService {
  constructor(private readonly domains: DomainClient) {}

  async build(input: { clientId: number; storeIds?: number[]; from: unknown; to: unknown; correlationId?: string }): Promise<ClientDivergenceReport> {
    const { clientId, correlationId } = input
    if (!Number.isInteger(clientId) || clientId <= 0) throw new BadRequestException('client_id is required')
    if (!isDay(input.from) || !isDay(input.to) || input.from > input.to) throw new BadRequestException('from and to are required, as YYYY-MM-DD, with from <= to')
    const { from, to } = input

    const client = (await this.domains.billing<BillingClient>({ method: 'get', path: `/billing/clients/${clientId}`, correlationId })).data
    if (!client?.id) throw new NotFoundException(`Client ${clientId} not found`)

    const codeByStore = new Map<number, string>()
    for (const site of client.sites ?? []) if (site.store_id !== null && site.store_id !== undefined) codeByStore.set(site.store_id, site.code)

    const selected = input.storeIds && input.storeIds.length > 0 ? [...new Set(input.storeIds)] : [...codeByStore.keys()]
    const foreign = selected.filter(id => !codeByStore.has(id))
    if (foreign.length > 0) throw new BadRequestException(`Store(s) ${foreign.join(', ')} are not units of client ${clientId}`)
    if (selected.length === 0) return this.assemble(client, from, to, [], new Map(), new Map(), codeByStore, 0)

    const supply = (await this.domains.supply<SupplyDivergences>({ method: 'get', path: `/reports/divergences?store_ids=${selected.join(',')}&from=${from}&to=${to}`, correlationId })).data
    const divergences = supply.divergences ?? []

    const skus = [...new Set(divergences.map(d => d.sku))]
    const names = new Map<string, string>()
    const prices = new Map<string, number>()

    if (skus.length > 0) {
      const products = (await this.domains.products<Array<{ sku: string; name: string }>>({ method: 'get', path: '/products', correlationId })).data
      for (const product of products) names.set(product.sku, product.name)

      // One lookup per identification day: the price is the one in force THEN, never today's.
      const days = new Map<string, Set<string>>()
      for (const d of divergences) {
        const day = d.identified_at.slice(0, 10)
        if (!days.has(day)) days.set(day, new Set())
        days.get(day)!.add(d.sku)
      }

      await inBatches([...days], 6, async ([day, daySkus]) => {
        const result = (await this.domains.products<BulkPrice>({ method: 'post', path: '/prices/bulk', payload: { skus: [...daySkus], as_of: day }, correlationId })).data
        for (const price of result.resolved) prices.set(`${price.sku}|${day}`, price.price_cents)
      })
    }

    return this.assemble(client, from, to, divergences, names, prices, codeByStore, supply.unsplit_visits ?? 0, selected)
  }

  private assemble(
    client: BillingClient,
    from: string,
    to: string,
    divergences: SupplyDivergence[],
    names: Map<string, string>,
    prices: Map<string, number>,
    codeByStore: Map<number, string>,
    unsplitVisits: number,
    selected: number[] = [],
  ): ClientDivergenceReport {
    const units: ClientDivergenceUnit[] = selected
      .map(storeId => {
        const rows: ClientDivergenceRow[] = divergences
          .filter(d => d.store_id === storeId)
          .map(d => {
            const unitPrice = prices.get(`${d.sku}|${d.identified_at.slice(0, 10)}`) ?? null

            return {
              sku: d.sku,
              product_name: names.get(d.sku) ?? 'Produto não cadastrado',
              quantity: d.quantity,
              previous_conference_at: d.previous_conference_at,
              identified_at: d.identified_at,
              unit_price_cents: unitPrice,
              loss_cents: unitPrice === null ? null : d.quantity * unitPrice,
              source: {
                identified: { ...d.identified_source, kind: d.identified_kind },
                previous: d.previous_conference_source && d.previous_conference_kind ? { ...d.previous_conference_source, kind: d.previous_conference_kind } : null,
              },
            }
          })
        // Largest quantity first within each unit (operator request); ties by identification instant, then product name.
        rows.sort(
          (a, b) =>
            b.quantity - a.quantity ||
            a.identified_at.localeCompare(b.identified_at) ||
            a.product_name.localeCompare(b.product_name, 'pt-BR') ||
            a.sku.localeCompare(b.sku),
        )
        const unpriced = rows.filter(row => row.loss_cents === null).length

        return {
          store_id: storeId,
          code: codeByStore.get(storeId) ?? String(storeId),
          rows,
          total_quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
          total_loss_cents: rows.reduce((sum, row) => sum + (row.loss_cents ?? 0), 0),
          unpriced_rows: unpriced,
          partial: unpriced > 0,
        }
      })
      .sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }))

    const all = units.flatMap(unit => unit.rows)
    const unpricedRows = units.reduce((sum, unit) => sum + unit.unpriced_rows, 0)

    return {
      client: { id: client.id, name: client.name },
      from,
      to,
      units,
      totals: {
        quantity: units.reduce((sum, unit) => sum + unit.total_quantity, 0),
        loss_cents: units.reduce((sum, unit) => sum + unit.total_loss_cents, 0),
        distinct_products: new Set(all.map(row => row.sku)).size,
        rows: all.length,
        unpriced_rows: unpricedRows,
        partial: unpricedRows > 0,
      },
      unsplit_visits: unsplitVisits,
    }
  }
}

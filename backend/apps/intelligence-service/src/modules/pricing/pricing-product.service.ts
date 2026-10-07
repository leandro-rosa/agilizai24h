import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { isSynthetic } from '../../common/synthetic'
import { FactsLoader, lastDayOf } from '../analysis/analysis.facts'
import { monthsBetween, shiftMonth } from '../refresh/months'
import { ProductsClient } from '../sources/products.client'
import { SalesClient } from '../sources/sales.client'
import { StoresClient } from '../sources/stores.client'
import { SupplyClient } from '../sources/supply.client'
import { buildHistory, type HistoryRow } from './history'
import type { PriceResult } from './price'
import { PricingRunsService, type PricingScope } from './pricing-runs.service'
import { assertPrice, simulate, type NotSimulable, type Simulation } from './simulate'

const HISTORY_MONTHS = 12

export interface ProductHistory {
  sku: string
  /** Labelled so a reader never mistakes it for the engine's economic margin. */
  marginKind: 'product_margin'
  rows: HistoryRow[]
}

export interface StoreRow {
  storeId: number
  storeName: string
  unitsSold: number
  revenueCents: number
  lostUnits: number
  restockedUnits: number
  /** `null` when the store restocked too little of the product to say. */
  lossRate: number | null
  /** The product's economic margin at the current price with this store's loss; `null` when it cannot be said. */
  estimatedMargin: number | null
}

export interface ProductStores {
  sku: string
  period: string
  /** Fees, tax and operating allocation are the network's, loss is the store's own. */
  note: string
  stores: StoreRow[]
  /** Stores that never recorded the period: missing, not zero sales. */
  missingStores: { storeId: number; storeName: string }[]
}

const STORE_NOTE = 'Taxas de pagamento, impostos e rateio operacional são os da rede; a perda é a da própria loja.'
/** A store that restocked fewer units than this has no loss rate worth showing. */
const MIN_RESTOCKED_FOR_LOSS = 10

@Injectable()
export class PricingProductService {
  private readonly loader: FactsLoader

  constructor(
    supply: SupplyClient,
    sales: SalesClient,
    private readonly products: ProductsClient,
    private readonly stores: StoresClient,
    private readonly runs: PricingRunsService,
  ) {
    this.loader = new FactsLoader(supply, sales)
  }

  /** Cost and price in force at the end of each month, with the product margin, the markup and the flags. */
  async history(sku: string, input: { period?: string; months?: number }, correlationId?: string): Promise<ProductHistory> {
    const scope = this.runs.scope(input.period)
    const count = Math.min(Math.max(input.months ?? HISTORY_MONTHS, 1), 36)
    const months = monthsBetween(shiftMonth(scope.period, -(count - 1)), scope.period)

    const catalogue = await this.products.products(correlationId)
    if (!catalogue.some(product => product.sku === sku)) throw new NotFoundException(`Product ${sku} not found`)

    const points = await Promise.all(
      months.map(async month => {
        const asOf = lastDayOf(month)
        const [costs, prices] = await Promise.all([this.products.costsAsOf([sku], asOf, correlationId), this.products.pricesAsOf([sku], asOf, correlationId)])

        return { month, costCents: costs.resolved[0]?.cost_cents ?? null, priceCents: prices.resolved[0]?.price_cents ?? null }
      }),
    )

    return { sku, marginKind: 'product_margin', rows: buildHistory(points) }
  }

  /** Simulates a typed price over the cost structure of the latest stored report. Writes nothing. */
  async simulate(sku: string, input: { priceCents: unknown; replacementCostCents?: unknown; period?: string; storeId?: number | null }): Promise<(Simulation | NotSimulable) & { reportRunId: string }> {
    const priceCents = assertPrice(input.priceCents)
    const { product, run, targetMargin } = await this.fromStoredReport(sku, { period: input.period, storeId: input.storeId })
    // An optional replacement quote the user chose to simulate with: a whole positive number of centavos or nothing, never assumed.
    const replacement = input.replacementCostCents === undefined || input.replacementCostCents === null ? null : assertPrice(input.replacementCostCents)
    const result = simulate({ structure: product.structure, currentPriceCents: product.currentPriceCents, monthlyUnits: product.monthlyUnits, targetMargin, priceCents, replacementCostCents: replacement })

    return { ...result, reportRunId: run }
  }

  /** Each store's own volume and loss for the product, at the current price. */
  async storesOf(sku: string, input: { period?: string }, correlationId?: string): Promise<ProductStores> {
    const scope = this.runs.scope(input.period)
    const { product } = await this.fromStoredReport(sku, { period: scope.period, storeId: null })
    const allStores = (await this.stores.stores(correlationId)).filter(store => !isSynthetic(store.name))
    const months = monthsBetween(shiftMonth(scope.period, -2), scope.period)
    const facts = await Promise.all(months.map(month => this.loader.month(month, allStores, correlationId)))

    const rows: StoreRow[] = []
    const missing: { storeId: number; storeName: string }[] = []

    for (const store of allStores) {
      const absent = facts.every(month => month.storesMissingSales.includes(store.id) && month.storesMissingSupply.includes(store.id))
      if (absent) {
        missing.push({ storeId: store.id, storeName: store.name })
        continue
      }

      let sold = 0
      let revenue = 0
      let lost = 0
      let restocked = 0
      for (const month of facts) {
        const cell = month.cells.get(store.id)?.get(sku)
        if (!cell) continue
        sold += cell.sold
        revenue += cell.revenueCents
        lost += cell.lost
        restocked += cell.restocked
      }

      const lossRate = restocked >= MIN_RESTOCKED_FOR_LOSS ? Math.min(lost / restocked, 0.95) : null
      rows.push({ storeId: store.id, storeName: store.name, unitsSold: sold, revenueCents: revenue, lostUnits: lost, restockedUnits: restocked, lossRate, estimatedMargin: this.marginWithLoss(product, lossRate) })
    }

    return { sku, period: scope.period, note: STORE_NOTE, stores: rows.sort((a, b) => b.revenueCents - a.revenueCents), missingStores: missing }
  }

  /** The economic margin at the current price if the product's loss were `lossRate`; the rest of the structure is the network's. */
  private marginWithLoss(product: PriceResult, lossRate: number | null): number | null {
    const structure = product.structure
    const price = product.currentPriceCents
    if (!structure || lossRate === null || price === null || price <= 0) return null

    const variableShare = structure.taxRate + structure.paymentRate + structure.operatingShare
    const unitCost = structure.productCostCents / (1 - lossRate) + structure.paymentFixedCents + (structure.perTransactionCents ?? 0)

    return (price * (1 - variableShare) - unitCost) / price
  }

  private async fromStoredReport(sku: string, scope: { period?: string; storeId?: number | null }) {
    const latest = await this.runs.latest({ period: scope.period, storeId: scope.storeId })
    if (latest.state !== 'ready' || !latest.report || !latest.run) {
      throw new ConflictException('Ainda não há um relatório calculado para este período e escopo. Calcule o relatório primeiro.')
    }

    const product = latest.report.products.find(candidate => candidate.sku === sku)
    if (!product) throw new NotFoundException(`Product ${sku} is not in the stored report`)

    return { product, run: latest.run.id, targetMargin: latest.report.summary.targetMargin, scope: latest.scope as PricingScope }
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { isSynthetic } from '../../common/synthetic'
import { ParametersService } from '../parameters/parameters.service'
import { SalesClient } from '../sources/sales.client'
import { ProductsClient, type ProductDto } from '../sources/products.client'
import { StoresClient } from '../sources/stores.client'
import { SupplyClient } from '../sources/supply.client'
import { productInsights, supplierInsights } from './analysis.insights'
import { compareMovements, movementOf, storeRows, type MonthFacts } from './analysis.metrics'
import { FactsLoader, lastDayOf, windowOf } from './analysis.facts'
import type {
  AnalysisMeta,
  CompareTo,
  CrossAnalysis,
  Movement,
  MovementWithComparison,
  MonthlyPoint,
  ProductAnalysis,
  ProductLine,
  SupplierAnalysis,
} from './analysis.types'
import { PurchaseSource } from './purchase-source'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

interface Context {
  meta: AnalysisMeta
  months: string[]
  facts: MonthFacts[]
  catalogue: ProductDto[]
  storeNames: Map<number, string>
  p: Awaited<ReturnType<ParametersService['current']>>['values']['analysis']
}

@Injectable()
export class AnalysisService {
  private readonly loader: FactsLoader

  constructor(
    supply: SupplyClient,
    sales: SalesClient,
    private readonly products: ProductsClient,
    private readonly stores: StoresClient,
    private readonly parameters: ParametersService,
    private readonly purchases: PurchaseSource,
  ) {
    this.loader = new FactsLoader(supply, sales)
  }

  async supplier(supplierId: number, period: string, compareTo: CompareTo, correlationId?: string, storeId?: number): Promise<SupplierAnalysis> {
    const ctx = await this.context(period, compareTo, correlationId)
    const lines = ctx.catalogue.filter(product => product.supplier_id === supplierId)
    const skus = new Set(lines.map(l => l.sku))
    const costs = await this.costs(ctx.months, [...skus], correlationId)
    const series = await this.series(ctx, skus, costs, storeId)
    const totals = this.withComparison(series, compareTo)

    const productLines: ProductLine[] = []
    for (const product of lines) {
      const one = new Set([product.sku])
      const perMonth = await this.series(ctx, one, costs, storeId)
      const withComparison = this.withComparison(perMonth, compareTo)
      productLines.push({ sku: product.sku, name: product.name, supplierId, movement: withComparison.current, comparison: withComparison.comparison })
    }

    const current = ctx.facts[ctx.facts.length - 1]
    const storesRestocked = this.storesWith(current, skus, storeId)

    return {
      meta: ctx.meta,
      supplierId,
      totals,
      products: productLines.sort((a, b) => revenue(b) - revenue(a)),
      evolution: this.evolution(ctx.months, series),
      insights: supplierInsights({
        movement: totals.current,
        comparison: totals.comparison,
        products: productLines,
        networkLossShare: this.networkLossShare(current),
        storesRestocked,
        compareTo,
        p: ctx.p,
      }),
    }
  }

  async product(sku: string, period: string, compareTo: CompareTo, correlationId?: string, storeId?: number): Promise<ProductAnalysis> {
    const ctx = await this.context(period, compareTo, correlationId)
    const product = ctx.catalogue.find(p => p.sku === sku)
    if (!product) throw new NotFoundException(`Product ${sku} not found`)

    const skus = new Set([sku])
    const costs = await this.costs(ctx.months, [sku], correlationId)
    const series = await this.series(ctx, skus, costs, storeId)
    const totals = this.withComparison(series, compareTo)
    const current = ctx.facts[ctx.facts.length - 1]
    // Insights compare a store with the network, so they read every store; only the table obeys the filter.
    const allStores = storeRows(current, skus, ctx.storeNames, ctx.p)
    const stores = allStores.filter(row => storeId === undefined || row.storeId === storeId)

    return {
      meta: ctx.meta,
      product: { sku, name: product.name, supplierId: product.supplier_id ?? null },
      totals,
      stores,
      evolution: this.evolution(ctx.months, series),
      insights: productInsights({ movement: totals.current, comparison: totals.comparison, stores: allStores, compareTo, p: ctx.p, networkLossShare: this.networkLossShare(current) }),
    }
  }

  async cross(supplierId: number, sku: string, period: string, compareTo: CompareTo, correlationId?: string): Promise<CrossAnalysis> {
    const ctx = await this.context(period, compareTo, correlationId)
    const product = ctx.catalogue.find(p => p.sku === sku)
    if (!product) throw new NotFoundException(`Product ${sku} not found`)

    const declared = product.supplier_id ?? null
    const linked = declared === supplierId
    let totals: MovementWithComparison | null = null

    if (linked) {
      const skus = new Set([sku])
      const costs = await this.costs(ctx.months, [sku], correlationId)
      totals = this.withComparison(await this.series(ctx, skus, costs), compareTo)
    }

    return {
      meta: ctx.meta,
      supplierId,
      product: { sku, name: product.name, declaredSupplierId: declared },
      linked,
      totals,
      // Comparing suppliers of one product needs the purchases that say who supplied what.
      suppliers: [],
      suppliersUnavailableReason: 'no_purchase_history',
    }
  }

  private async context(period: string, compareTo: CompareTo, correlationId?: string): Promise<Context> {
    if (!PERIOD.test(period)) throw new BadRequestException('period must be YYYY-MM')
    if (compareTo !== 'prev_month' && compareTo !== 'avg_3m') throw new BadRequestException('compareTo must be prev_month or avg_3m')

    const months = windowOf(period)
    const [version, stores, catalogue] = await Promise.all([this.parameters.current(), this.stores.stores(correlationId), this.products.products(correlationId)])
    const facts: MonthFacts[] = []
    for (const month of months) facts.push(await this.loader.month(month, stores, correlationId))

    return {
      meta: {
        period,
        compareTo,
        parameterVersion: version.id,
        dataQuality: {
          monthsWithGaps: facts
            .filter(f => f.storesMissingSupply.length > 0 || f.storesMissingSales.length > 0)
            .map(f => ({ month: f.month, storesMissingSupply: f.storesMissingSupply.length, storesMissingSales: f.storesMissingSales.length })),
          purchaseBaseFrom: await this.purchases.baseFrom(),
        },
      },
      months,
      facts,
      catalogue: catalogue.filter(p => !isSynthetic(p.name)),
      storeNames: new Map(stores.map(s => [s.id, s.name])),
      p: version.values.analysis,
    }
  }

  /** Unit cost per SKU as of the last day of each month; a SKU without a resolved cost is simply absent. */
  private async costs(months: string[], skus: string[], correlationId?: string): Promise<Map<string, Map<string, number>>> {
    const out = new Map<string, Map<string, number>>()
    for (const month of months) {
      const resolved = skus.length > 0 ? (await this.products.costsAsOf(skus, lastDayOf(month), correlationId)).resolved : []
      out.set(month, new Map(resolved.map(r => [r.sku, r.cost_cents])))
    }

    return out
  }

  private async series(ctx: Context, skus: Set<string>, costs: Map<string, Map<string, number>>, storeId?: number): Promise<Movement[]> {
    const out: Movement[] = []
    for (const facts of ctx.facts) {
      const monthCosts = costs.get(facts.month)
      out.push(movementOf(facts, skus, sku => monthCosts?.get(sku) ?? null, await this.purchases.month([...skus], facts.month), storeId))
    }

    return out
  }

  private withComparison(series: Movement[], compareTo: CompareTo): MovementWithComparison {
    const current = series[series.length - 1]

    return { current, comparison: compareMovements(current, series.slice(0, -1), compareTo) }
  }

  private evolution(months: string[], series: Movement[]): MonthlyPoint[] {
    return months.map((month, i) => ({ month, purchasedUnits: series[i].purchasedUnits, restocked: series[i].restocked, sold: series[i].sold, lost: series[i].lost }))
  }

  private storesWith(facts: MonthFacts, skus: Set<string>, storeId?: number): number {
    let count = 0
    for (const [id, cells] of facts.cells) {
      if (storeId !== undefined && id !== storeId) continue
      if ([...cells].some(([sku, cell]) => skus.has(sku) && cell.restocked > 0)) count++
    }

    return count
  }

  /** Lost ÷ restocked over every SKU of the network that month; null when no supply was ingested. */
  private networkLossShare(facts: MonthFacts): number | null {
    let restocked = 0
    let lost = 0
    for (const cells of facts.cells.values())
      for (const cell of cells.values()) {
        restocked += cell.restocked
        lost += cell.lost
      }

    return restocked > 0 ? lost / restocked : null
  }
}

function revenue(line: ProductLine): number {
  return line.movement.revenueCents.available ? line.movement.revenueCents.value : 0
}

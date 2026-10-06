import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { isSynthetic } from '../../common/synthetic'
import { ParametersService } from '../parameters/parameters.service'
import { monthsBetween, shiftMonth } from '../refresh/months'
import { SalesClient } from '../sources/sales.client'
import { ProductsClient, type ProductDto } from '../sources/products.client'
import { StoresClient } from '../sources/stores.client'
import { SupplyClient } from '../sources/supply.client'
import { productInsights, supplierInsights } from './analysis.insights'
import { compareMovements, mergeFacts, movementOf, movementOfParts, storeRows, type MonthFacts, type MovementPart } from './analysis.metrics'
import { FactsLoader, WINDOW_MONTHS, lastDayOf } from './analysis.facts'
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
/** The longest range read in one call: a year, and the year before it for the comparison. */
const MAX_RANGE_MONTHS = 12

interface Context {
  meta: AnalysisMeta
  /** Every month read, oldest first: the comparison period, the range, and enough history for the evolution. */
  months: string[]
  facts: MonthFacts[]
  /** Indexes into `months` of the selected range and, for a multi-month range, of the period before it. */
  range: number[]
  before: number[]
  display: number[]
  referenceText?: string
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

  async supplier(supplierId: number, period: string, compareTo: CompareTo, correlationId?: string, storeId?: number, from?: string): Promise<SupplierAnalysis> {
    const ctx = await this.context(from ?? period, period, compareTo, correlationId)
    const lines = ctx.catalogue.filter(product => product.supplier_id === supplierId)
    const skus = new Set(lines.map(l => l.sku))
    const costs = await this.costs(ctx.months, [...skus], correlationId)
    const totals = await this.totals(ctx, skus, costs, compareTo, storeId)

    const productLines: ProductLine[] = []
    for (const product of lines) {
      const withComparison = await this.totals(ctx, new Set([product.sku]), costs, compareTo, storeId)
      productLines.push({ sku: product.sku, name: product.name, supplierId, movement: withComparison.current, comparison: withComparison.comparison })
    }

    const rangeFacts = mergeFacts(ctx.range.map(i => ctx.facts[i]))
    const rated = productLines.filter(line => line.movement.marginShare.available)
    const low = rated.filter(line => line.movement.marginShare.available && line.movement.marginShare.value < ctx.p.attentionMargin)
    const attention = { threshold: ctx.p.attentionMargin, count: low.length, rated: rated.length, skus: low.map(line => line.sku) }

    return {
      meta: ctx.meta,
      supplierId,
      totals,
      attention,
      products: productLines.sort((a, b) => revenue(b) - revenue(a)),
      evolution: await this.evolution(ctx, skus, costs, storeId),
      insights: supplierInsights({
        movement: totals.current,
        comparison: totals.comparison,
        products: productLines,
        lowMargin: low,
        networkLossShare: this.networkLossShare(rangeFacts),
        storesRestocked: this.storesWith(rangeFacts, skus, storeId),
        compareTo,
        referenceText: ctx.referenceText,
        p: ctx.p,
      }),
    }
  }

  async product(sku: string, period: string, compareTo: CompareTo, correlationId?: string, storeId?: number, from?: string): Promise<ProductAnalysis> {
    const ctx = await this.context(from ?? period, period, compareTo, correlationId)
    const product = ctx.catalogue.find(p => p.sku === sku)
    if (!product) throw new NotFoundException(`Product ${sku} not found`)

    const skus = new Set([sku])
    const costs = await this.costs(ctx.months, [sku], correlationId)
    const totals = await this.totals(ctx, skus, costs, compareTo, storeId)
    const rangeFacts = mergeFacts(ctx.range.map(i => ctx.facts[i]))
    // Insights compare a store with the network, so they read every store; only the table obeys the filter.
    const allStores = storeRows(rangeFacts, skus, ctx.storeNames, ctx.p)
    const stores = allStores.filter(row => storeId === undefined || row.storeId === storeId)

    return {
      meta: ctx.meta,
      product: { sku, name: product.name, supplierId: product.supplier_id ?? null },
      totals,
      stores,
      evolution: await this.evolution(ctx, skus, costs, storeId),
      insights: productInsights({
        movement: totals.current,
        comparison: totals.comparison,
        stores: allStores,
        compareTo,
        referenceText: ctx.referenceText,
        p: ctx.p,
        networkLossShare: this.networkLossShare(rangeFacts),
      }),
    }
  }

  async cross(supplierId: number, sku: string, period: string, compareTo: CompareTo, correlationId?: string, from?: string): Promise<CrossAnalysis> {
    const ctx = await this.context(from ?? period, period, compareTo, correlationId)
    const product = ctx.catalogue.find(p => p.sku === sku)
    if (!product) throw new NotFoundException(`Product ${sku} not found`)

    const declared = product.supplier_id ?? null
    const linked = declared === supplierId
    let totals: MovementWithComparison | null = null

    if (linked) totals = await this.totals(ctx, new Set([sku]), await this.costs(ctx.months, [sku], correlationId), compareTo)

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

  private async context(from: string, to: string, compareTo: CompareTo, correlationId?: string): Promise<Context> {
    if (!PERIOD.test(from) || !PERIOD.test(to)) throw new BadRequestException('period and from must be YYYY-MM')
    if (compareTo !== 'prev_month' && compareTo !== 'avg_3m') throw new BadRequestException('compareTo must be prev_month or avg_3m')
    if (from > to) throw new BadRequestException('from cannot be after period')

    const rangeMonths = monthsBetween(from, to)
    const length = rangeMonths.length
    if (length > MAX_RANGE_MONTHS) throw new BadRequestException(`a range spans at most ${MAX_RANGE_MONTHS} months`)
    if (length > 1 && compareTo === 'avg_3m') throw new BadRequestException('avg_3m compares a single month; a range is compared with the period right before it')

    // A single month reads the six months ending there (evolution and 3-month average). A range reads itself,
    // the period before it of the same length, and enough earlier months to still show six in the evolution.
    const start = length === 1 ? shiftMonth(to, -(WINDOW_MONTHS - 1)) : [shiftMonth(from, -length), shiftMonth(to, -(WINDOW_MONTHS - 1))].sort()[0]
    const months = monthsBetween(start, to)
    const index = (list: string[]) => list.map(m => months.indexOf(m))
    const beforeMonths = length > 1 ? monthsBetween(shiftMonth(from, -length), shiftMonth(from, -1)) : []

    const [version, stores, catalogue] = await Promise.all([this.parameters.current(), this.stores.stores(correlationId), this.products.products(correlationId)])
    const facts: MonthFacts[] = []
    for (const month of months) facts.push(await this.loader.month(month, stores, correlationId))

    const displayStart = length >= WINDOW_MONTHS ? from : shiftMonth(to, -(WINDOW_MONTHS - 1))

    return {
      meta: {
        period: to,
        from,
        months: length,
        previous: length > 1 ? { from: beforeMonths[0], to: beforeMonths[beforeMonths.length - 1] } : null,
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
      range: index(rangeMonths),
      before: index(beforeMonths),
      display: index(monthsBetween(displayStart, to)),
      referenceText: length > 1 ? `ao período anterior (${monthLabel(beforeMonths[0])} a ${monthLabel(beforeMonths[beforeMonths.length - 1])})` : undefined,
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

  private async parts(ctx: Context, indexes: number[], skus: Set<string>, costs: Map<string, Map<string, number>>): Promise<MovementPart[]> {
    const parts: MovementPart[] = []
    for (const i of indexes) {
      const month = ctx.months[i]
      const monthCosts = costs.get(month)
      parts.push({ facts: ctx.facts[i], cost: sku => monthCosts?.get(sku) ?? null, purchases: await this.purchases.month([...skus], month) })
    }

    return parts
  }

  /** The range's movement and its comparison: the previous month or 3-month mean for one month, the period right before for a range. */
  private async totals(ctx: Context, skus: Set<string>, costs: Map<string, Map<string, number>>, compareTo: CompareTo, storeId?: number): Promise<MovementWithComparison> {
    const current = movementOfParts(await this.parts(ctx, ctx.range, skus, costs), skus, storeId)

    if (ctx.range.length > 1) {
      const before = movementOfParts(await this.parts(ctx, ctx.before, skus, costs), skus, storeId)

      return { current, comparison: compareMovements(current, [before], 'prev_month') }
    }

    const earlier: Movement[] = []
    for (const i of Array.from({ length: ctx.range[0] }, (_, k) => k)) earlier.push(movementOfParts(await this.parts(ctx, [i], skus, costs), skus, storeId))

    return { current, comparison: compareMovements(current, earlier, compareTo) }
  }

  private async evolution(ctx: Context, skus: Set<string>, costs: Map<string, Map<string, number>>, storeId?: number): Promise<MonthlyPoint[]> {
    const points: MonthlyPoint[] = []
    for (const i of ctx.display) {
      const m = movementOfParts(await this.parts(ctx, [i], skus, costs), skus, storeId)
      points.push({ month: ctx.months[i], purchasedUnits: m.purchasedUnits, restocked: m.restocked, sold: m.sold, lost: m.lost })
    }

    return points
  }

  private storesWith(facts: MonthFacts, skus: Set<string>, storeId?: number): number {
    let count = 0
    for (const [id, cells] of facts.cells) {
      if (storeId !== undefined && id !== storeId) continue
      if ([...cells].some(([sku, cell]) => skus.has(sku) && cell.restocked > 0)) count++
    }

    return count
  }

  /** Lost ÷ restocked over every SKU of the network over the range; null when no supply was ingested. */
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

const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** `2026-04` → `abr/2026`, the way the panel writes months. */
function monthLabel(month: string): string {
  const [year, number] = month.split('-').map(Number)

  return `${MONTH_ABBR[number - 1]}/${year}`
}

function revenue(line: ProductLine): number {
  return line.movement.revenueCents.available ? line.movement.revenueCents.value : 0
}

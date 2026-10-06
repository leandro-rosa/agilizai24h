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
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
/** The longest day range read in one call. */
const MAX_RANGE_DAYS = 366
const DAY_MS = 86_400_000

/** The range asked for: both ends are months (`YYYY-MM`) or both are days (`YYYY-MM-DD`). */
export interface RangeInput {
  from: string
  to: string
}

/** A slice of the range: a whole month (exact monthly records) or some days of one (visits and receipts). */
interface Segment {
  month: string
  facts: MonthFacts
  lossEstimated: boolean
}
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
  /** Set for a range that is not whole months: the slices of the range and of the period right before it. */
  segments?: { current: Segment[]; previous: Segment[] }
  /** Months whose unit cost is needed (every month a slice falls in). */
  costMonths: string[]
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

  async supplier(supplierId: number, range: RangeInput, compareTo: CompareTo, correlationId?: string, storeId?: number): Promise<SupplierAnalysis> {
    const ctx = await this.context(range, compareTo, correlationId)
    const lines = ctx.catalogue.filter(product => product.supplier_id === supplierId)
    const skus = new Set(lines.map(l => l.sku))
    const costs = await this.costs(ctx.costMonths, [...skus], correlationId)
    const totals = await this.totals(ctx, skus, costs, compareTo, storeId)

    const productLines: ProductLine[] = []
    for (const product of lines) {
      const withComparison = await this.totals(ctx, new Set([product.sku]), costs, compareTo, storeId)
      productLines.push({ sku: product.sku, name: product.name, supplierId, movement: withComparison.current, comparison: withComparison.comparison })
    }

    const rangeFacts = this.rangeFacts(ctx)
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

  async product(sku: string, range: RangeInput, compareTo: CompareTo, correlationId?: string, storeId?: number): Promise<ProductAnalysis> {
    const ctx = await this.context(range, compareTo, correlationId)
    const product = ctx.catalogue.find(p => p.sku === sku)
    if (!product) throw new NotFoundException(`Product ${sku} not found`)

    const skus = new Set([sku])
    const costs = await this.costs(ctx.costMonths, [sku], correlationId)
    const totals = await this.totals(ctx, skus, costs, compareTo, storeId)
    const rangeFacts = this.rangeFacts(ctx)
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

  async cross(supplierId: number, sku: string, range: RangeInput, compareTo: CompareTo, correlationId?: string): Promise<CrossAnalysis> {
    const ctx = await this.context(range, compareTo, correlationId)
    const product = ctx.catalogue.find(p => p.sku === sku)
    if (!product) throw new NotFoundException(`Product ${sku} not found`)

    const declared = product.supplier_id ?? null
    const linked = declared === supplierId
    let totals: MovementWithComparison | null = null

    if (linked) totals = await this.totals(ctx, new Set([sku]), await this.costs(ctx.costMonths, [sku], correlationId), compareTo)

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

  private async context(range: RangeInput, compareTo: CompareTo, correlationId?: string): Promise<Context> {
    if (compareTo !== 'prev_month' && compareTo !== 'avg_3m') throw new BadRequestException('compareTo must be prev_month or avg_3m')

    const { fromDate, toDate } = normalise(range)
    const monthAligned = fromDate.endsWith('-01') && toDate === lastDayOf(toDate.slice(0, 7))
    if (monthAligned) return this.monthContext(fromDate.slice(0, 7), toDate.slice(0, 7), compareTo, correlationId)

    return this.dayContext(fromDate, toDate, compareTo, correlationId)
  }

  /** A range made of whole months: the monthly records, exactly as before. */
  private async monthContext(from: string, to: string, compareTo: CompareTo, correlationId?: string): Promise<Context> {
    if (!PERIOD.test(from) || !PERIOD.test(to)) throw new BadRequestException('period and from must be YYYY-MM')
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
    const displayStart = length >= WINDOW_MONTHS ? from : shiftMonth(to, -(WINDOW_MONTHS - 1))
    const base = await this.base(months, correlationId)

    return {
      ...base,
      meta: {
        period: to,
        from,
        months: length,
        granularity: 'month',
        fromDate: `${from}-01`,
        toDate: lastDayOf(to),
        days: dayCount(`${from}-01`, lastDayOf(to)),
        comparisonLabel: length > 1 ? 'período anterior' : compareTo === 'avg_3m' ? 'média de 3 meses' : 'mês anterior',
        daily: null,
        previous: length > 1 ? { from: beforeMonths[0], to: beforeMonths[beforeMonths.length - 1] } : null,
        compareTo,
        parameterVersion: base.version,
        dataQuality: base.dataQuality,
      },
      months,
      range: index(rangeMonths),
      before: index(beforeMonths),
      display: index(monthsBetween(displayStart, to)),
      referenceText: length > 1 ? `ao período anterior (${monthLabel(beforeMonths[0])} a ${monthLabel(beforeMonths[beforeMonths.length - 1])})` : undefined,
      costMonths: months,
    }
  }

  /**
   * A range that is not whole months. Whole months inside it use the monthly records; the edge months are read by day —
   * restocks from the visits, sales from the dated receipts, losses allocated (flagged as estimated). The comparison is
   * the period of the same length right before it.
   */
  private async dayContext(fromDate: string, toDate: string, compareTo: CompareTo, correlationId?: string): Promise<Context> {
    const days = dayCount(fromDate, toDate)
    if (days > MAX_RANGE_DAYS) throw new BadRequestException(`a day range spans at most ${MAX_RANGE_DAYS} days`)
    if (compareTo === 'avg_3m') throw new BadRequestException('avg_3m compares a single month; a day range is compared with the period right before it')

    const prevTo = addDays(fromDate, -1)
    const prevFrom = addDays(fromDate, -days)
    const currentPlan = slices(fromDate, toDate)
    const previousPlan = slices(prevFrom, prevTo)
    const fromMonth = fromDate.slice(0, 7)
    const toMonth = toDate.slice(0, 7)
    const rangeMonths = monthsBetween(fromMonth, toMonth)
    const displayStart = rangeMonths.length >= WINDOW_MONTHS ? fromMonth : shiftMonth(toMonth, -(WINDOW_MONTHS - 1))
    const displayMonths = monthsBetween(displayStart, toMonth)
    const wholeMonths = [...currentPlan, ...previousPlan].filter(slice => slice.whole).map(slice => slice.month)
    const months = [...new Set([...displayMonths, ...wholeMonths])].sort()
    const sliceMonths = [...new Set([...currentPlan, ...previousPlan].map(slice => slice.month))]
    const base = await this.base(months, correlationId)
    const stores = base.stores
    const monthIndex = (month: string) => months.indexOf(month)

    const build = async (plan: ReturnType<typeof slices>): Promise<Segment[]> => {
      const out: Segment[] = []
      for (const slice of plan) {
        if (slice.whole) out.push({ month: slice.month, facts: base.facts[monthIndex(slice.month)], lossEstimated: false })
        else {
          const day = await this.loader.days(slice.month, slice.from, slice.to, stores, correlationId)
          out.push({ month: slice.month, facts: day.facts, lossEstimated: day.lossEstimated })
        }
      }

      return out
    }
    const current = await build(currentPlan)
    const previous = await build(previousPlan)

    // Which edge months have no receipts with a date: their day sales are unknown, and the screen says so.
    const salesDetailMissingMonths = [...new Set(currentPlan.filter(slice => !slice.whole).map(slice => slice.month))].filter(month => {
      const segment = current.find(c => c.month === month && c.lossEstimated)

      return segment ? segment.facts.storesMissingSales.length >= segment.facts.storeCount : false
    })

    return {
      ...base,
      meta: {
        period: toMonth,
        from: fromMonth,
        months: rangeMonths.length,
        granularity: 'day',
        fromDate,
        toDate,
        days,
        comparisonLabel: 'período anterior',
        daily: { salesDetailMissingMonths, lossEstimated: current.some(segment => segment.lossEstimated) },
        previous: { from: prevFrom, to: prevTo },
        compareTo: 'prev_month',
        parameterVersion: base.version,
        dataQuality: base.dataQuality,
      },
      months,
      range: [],
      before: [],
      display: displayMonths.map(monthIndex),
      referenceText: `ao período anterior (${dayLabel(prevFrom)} a ${dayLabel(prevTo)})`,
      segments: { current, previous },
      costMonths: [...new Set([...months, ...sliceMonths])].sort(),
    }
  }

  /** What every range needs: parameters, stores, catalogue and the monthly facts of `months`. */
  private async base(months: string[], correlationId?: string) {
    const [version, stores, catalogue] = await Promise.all([this.parameters.current(), this.stores.stores(correlationId), this.products.products(correlationId)])
    const facts: MonthFacts[] = []
    for (const month of months) facts.push(await this.loader.month(month, stores, correlationId))

    return {
      version: version.id,
      stores,
      facts,
      dataQuality: {
        monthsWithGaps: facts
          .filter(f => f.storesMissingSupply.length > 0 || f.storesMissingSales.length > 0)
          .map(f => ({ month: f.month, storesMissingSupply: f.storesMissingSupply.length, storesMissingSales: f.storesMissingSales.length })),
        purchaseBaseFrom: await this.purchases.baseFrom(),
      },
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

  /** Purchases are recorded by month, so only whole-month slices carry them; a few days of a month have none to show. */
  private async segmentParts(segments: Segment[], skus: Set<string>, costs: Map<string, Map<string, number>>): Promise<MovementPart[]> {
    const parts: MovementPart[] = []
    for (const segment of segments) {
      const monthCosts = costs.get(segment.month)
      parts.push({
        facts: segment.facts,
        cost: sku => monthCosts?.get(sku) ?? null,
        purchases: segment.lossEstimated ? null : await this.purchases.month([...skus], segment.month),
        lossEstimated: segment.lossEstimated,
      })
    }

    return parts
  }

  /** Every store's cells over the range, for the per-store table and the network ratios. */
  private rangeFacts(ctx: Context): MonthFacts {
    return mergeFacts(ctx.segments ? ctx.segments.current.map(segment => segment.facts) : ctx.range.map(i => ctx.facts[i]))
  }

  /** The range's movement and its comparison: the previous month or 3-month mean for one month, the period right before for a range. */
  private async totals(ctx: Context, skus: Set<string>, costs: Map<string, Map<string, number>>, compareTo: CompareTo, storeId?: number): Promise<MovementWithComparison> {
    if (ctx.segments) {
      const current = movementOfParts(await this.segmentParts(ctx.segments.current, skus, costs), skus, storeId)
      const previous = movementOfParts(await this.segmentParts(ctx.segments.previous, skus, costs), skus, storeId)

      return { current, comparison: compareMovements(current, [previous], 'prev_month') }
    }

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

/** Both ends of the range as days, whichever form they came in; refuses anything that is not a real date. */
function normalise(range: RangeInput): { fromDate: string; toDate: string } {
  const bothDays = DAY.test(range.from) && DAY.test(range.to)
  const bothMonths = PERIOD.test(range.from) && PERIOD.test(range.to)
  if (!bothDays && !bothMonths) throw new BadRequestException('the range must be two months (YYYY-MM) or two days (YYYY-MM-DD)')

  const fromDate = bothDays ? range.from : `${range.from}-01`
  const toDate = bothDays ? range.to : lastDayOf(range.to)
  for (const day of [fromDate, toDate]) {
    if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new BadRequestException(`${day} is not a real date`)
  }
  if (fromDate > toDate) throw new BadRequestException('from cannot be after the end of the range')

  return { fromDate, toDate }
}

const toMs = (day: string) => new Date(`${day}T00:00:00Z`).getTime()

function dayCount(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1
}

function addDays(day: string, delta: number): string {
  return new Date(toMs(day) + delta * DAY_MS).toISOString().slice(0, 10)
}

/** `2026-09-30` → `30/09`. */
function dayLabel(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`
}

/** Splits a day range by calendar month; a slice that covers its whole month is exact (monthly records). */
function slices(from: string, to: string): { month: string; from: string; to: string; whole: boolean }[] {
  const out: { month: string; from: string; to: string; whole: boolean }[] = []
  for (const month of monthsBetween(from.slice(0, 7), to.slice(0, 7))) {
    const first = `${month}-01`
    const last = lastDayOf(month)
    const start = from > first ? from : first
    const end = to < last ? to : last
    out.push({ month, from: start, to: end, whole: start === first && end === last })
  }

  return out
}

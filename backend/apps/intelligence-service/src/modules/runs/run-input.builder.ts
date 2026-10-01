import { Injectable } from '@nestjs/common'
import type { LossReason, MonthlyFacts, NonLossReasonKey, PairInput, VisitPoint } from '../engine/engine.types'
import type { Parameters } from '../parameters/parameters.types'
import { BaselineRepository } from '../baseline/baseline.repository'
import { ProductsClient, type ProductDto } from '../sources/products.client'
import { SalesClient } from '../sources/sales.client'
import { SupplyClient, type SupplyVisitDto } from '../sources/supply.client'

export interface RunContext {
  rangeFrom: string
  rangeTo: string
  asOf: Date
  parameters: Parameters
  months: string[]
  /** Unit cost by SKU as of the run, resolved once for the whole run; absent = unresolved, never zero. */
  costs: Map<string, number>
  catalogue: Map<string, ProductDto>
  correlationId?: string
}

export interface StoreInputs {
  inputs: PairInput[]
  /** Per month: whether the store had supply and imported sales — feeds the run's availability. */
  months: { month: string; supplyPresent: boolean; salesPresent: boolean }[]
}

const REASONS = new Set<string>(['expired', 'damaged_product', 'other_reason', 'return', 'transfer', 'internal_use'])

/**
 * Turns what the sibling services hold for ONE store into one engine input per
 * SKU. Read-only. A month that was never imported is a GAP carried as such
 * (`salesPresent: false`), never a month of zero sales.
 */
@Injectable()
export class RunInputBuilder {
  constructor(
    private readonly supply: SupplyClient,
    private readonly sales: SalesClient,
    private readonly products: ProductsClient,
    private readonly baselines: BaselineRepository,
  ) {}

  /** Costs for every SKU of the catalogue as of the run date, once per run. */
  async buildContext(rangeFrom: string, rangeTo: string, asOf: Date, parameters: Parameters, months: string[], correlationId?: string): Promise<RunContext> {
    const catalogueList = await this.products.products(correlationId)
    const asOfDate = asOf.toISOString().slice(0, 10)
    const resolved = await this.products.costsAsOf(
      catalogueList.map(product => product.sku),
      asOfDate,
      correlationId,
    )

    return {
      rangeFrom,
      rangeTo,
      asOf,
      parameters,
      months,
      costs: new Map(resolved.resolved.map(row => [row.sku, row.cost_cents])),
      catalogue: new Map(catalogueList.map(product => [product.sku, product])),
      correlationId,
    }
  }

  async buildStore(storeId: number, ctx: RunContext, skipSku: (sku: string) => boolean): Promise<StoreInputs> {
    const visits = await this.supply.visits(storeId, ctx.rangeFrom, ctx.rangeTo, ctx.correlationId)

    const monthsInfo: StoreInputs['months'] = []
    const monthlyBySku = new Map<string, Map<string, MonthlyFacts>>()
    const salesMonthsMissing: string[] = []

    for (const month of ctx.months) {
      const [period, salesRows] = await Promise.all([this.supply.period(storeId, month, ctx.correlationId), this.sales.period(storeId, month, ctx.correlationId)])

      monthsInfo.push({ month, supplyPresent: period !== null, salesPresent: salesRows !== null })
      if (salesRows === null) salesMonthsMissing.push(month)

      const touch = (sku: string): MonthlyFacts => {
        const bySku = monthlyBySku.get(sku) ?? new Map<string, MonthlyFacts>()
        monthlyBySku.set(sku, bySku)
        const existing = bySku.get(month) ?? { month, salesPresent: salesRows !== null, sold: 0, revenueCents: 0, removals: {}, restocked: 0 }
        bySku.set(month, existing)
        return existing
      }

      for (const row of salesRows ?? []) {
        const facts = touch(row.sku)
        facts.sold += row.quantity_sold
        facts.revenueCents += row.revenue_cents
      }
      for (const row of period?.restocks ?? []) touch(row.sku).restocked += row.quantity_restocked
      for (const row of period?.removals ?? []) {
        if (!REASONS.has(row.reason)) continue
        const facts = touch(row.sku)
        const key = row.reason as LossReason | NonLossReasonKey
        facts.removals[key] = (facts.removals[key] ?? 0) + row.quantity_removed
      }
    }

    const visitsBySku = groupVisitsBySku(visits)
    const skus = [...new Set([...visitsBySku.keys(), ...monthlyBySku.keys()])].filter(sku => !skipSku(sku)).sort()
    const inputs: PairInput[] = []

    for (const sku of skus) {
      const baseline = await this.resolveBaseline(sku, ctx.asOf)
      const facts = monthlyBySku.get(sku)
      const product = ctx.catalogue.get(sku)

      inputs.push({
        storeId,
        sku,
        visits: visitsBySku.get(sku) ?? [],
        // Every month of the range, so a month with no row for this SKU still says whether sales were imported.
        monthly: ctx.months.map(month => facts?.get(month) ?? { month, salesPresent: !salesMonthsMissing.includes(month), sold: 0, revenueCents: 0, removals: {}, restocked: 0 }),
        baseline: baseline.quantity,
        baselineIsOfRecord: baseline.ofRecord,
        costCents: ctx.costs.get(sku) ?? null,
        unitsPerPackage: product?.units_per_package ?? null,
        salesMonthsMissing,
        // Not available from any read-only source today; listed as a limitation of the run rather than guessed.
        rejectedAtIngestion: false,
        baselineConflict: false,
        plannedRefillIntervalDays: null,
        network: null,
        asOf: ctx.asOf,
        parameters: ctx.parameters,
      })
    }

    return { inputs, months: monthsInfo }
  }

  /**
   * The baseline in force at the reference date; when none had taken effect yet
   * (history starts when the owner first imported it), the baseline of record,
   * marked so every result that rests on it says the quantity of the time is unknown.
   */
  private async resolveBaseline(sku: string, asOf: Date): Promise<{ quantity: number | null; ofRecord: boolean }> {
    const inForce = await this.baselines.current(sku, asOf)
    if (inForce) return { quantity: inForce.quantity, ofRecord: false }

    const ofRecord = await this.baselines.current(sku, new Date())
    return { quantity: ofRecord?.quantity ?? null, ofRecord: ofRecord !== null }
  }
}

function groupVisitsBySku(visits: SupplyVisitDto[]): Map<string, VisitPoint[]> {
  const bySku = new Map<string, VisitPoint[]>()

  for (const visit of visits) {
    for (const line of visit.lines) {
      const list = bySku.get(line.sku) ?? []
      list.push({
        endedAt: new Date(visit.ended_at),
        balanceBefore: line.balance_before,
        confirmedCount: line.confirmed_count,
        restocked: line.restocked,
        removedTotal: line.removed_total,
        adjustment: line.adjustment,
        balanceAfter: line.balance_after,
      })
      bySku.set(line.sku, list)
    }
  }

  return bySku
}

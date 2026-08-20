import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { ReconciliationRepository } from '../../db-client/repositories/reconciliation.repository'
import { UpstreamClient } from './upstream.client'
import type { Reconciliation } from '../../../../generated/prisma/client'
import { reconcile, valuationDateFor, type SkuQuantities } from '../utils/reconcile'

export interface ReconciliationView {
  store_id: number
  period: string
  restocked_value_cents: number
  cogs_cents: number
  remaining_value_cents: number
  loss_value_cents: number
  loss_quantity: number
  /** The unclassified stock adjustment, valued at current cost (design D6) — a fifth figure, never folded into the four. */
  unclassified_stock_adjustment_value_cents: number
  valuation_date: string
  complete: boolean
  computed_at: Date
  /**
   * When the inputs this was computed from last changed, or null for a manual
   * recompute. A figure computed before its inputs last changed is stale.
   */
  inputs_changed_at: Date | null
  loss_by_reason: { reason: string; quantity: number; value_cents: number }[]
  loss_by_sku: { sku: string; quantity: number; value_cents: number }[]
  loss_by_reason_sku: { reason: string; sku: string; quantity: number; value_cents: number }[]
  unvalued: { sku: string; reason: string; restocked: number; sold: number; remaining: number; loss_quantity: number }[]
  /** SKUs whose remaining balance inventory-service flagged as inconsistent. */
  inconsistent_stock: string[]
  /** Every SKU with a non-zero adjustment this period, largest magnitude first — for manual review, not correction. */
  adjustment_flags: { sku: string; quantity: number; value_cents: number }[]
}

export interface RollupView {
  period: string
  restocked_value_cents: number
  cogs_cents: number
  remaining_value_cents: number
  loss_value_cents: number
  unclassified_stock_adjustment_value_cents: number
  store_count: number
  /** False when ANY contributing store's month is incomplete. */
  complete: boolean
  incomplete_stores: number[]
}

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name)

  constructor(
    private readonly prisma: PrismaClientService,
    private readonly reconciliations: ReconciliationRepository,
    private readonly upstream: UpstreamClient,
  ) {}

  /**
   * Values one store-month and stores the result.
   *
   * Idempotent: the store-month's figures are replaced wholesale in one
   * transaction, matching the contract sales and supply already use. The period
   * event is delivered at least once, so a repeat must produce identical
   * figures rather than doubling anything.
   */
  async recompute(
    storeId: number,
    period: string,
    options: { correlationId?: string; inputsChangedAt?: string } = {},
  ): Promise<ReconciliationView> {
    const { correlationId, inputsChangedAt } = options

    const [supply, sales, stock] = await Promise.all([
      this.upstream.supplyFor(storeId, period, correlationId),
      this.upstream.salesFor(storeId, period, correlationId),
      this.upstream.stockFor(storeId, period, correlationId),
    ])

    const quantities = this.mergeQuantities(supply, sales, stock)

    // Costs are resolved as of the month's last day, and that date is recorded
    // on the result — so re-reading a historical month cannot pick up a cost
    // that took effect afterwards, and the approximation stays visible.
    const valuationDate = valuationDateFor(period)
    const costs = await this.upstream.costsAsOf(
      quantities.map(item => item.sku),
      valuationDate,
      correlationId,
    )

    const result = reconcile(quantities, costs.resolved, costs.unresolved)

    await this.prisma.$transaction(async tx => {
      await tx.reconciliation.deleteMany({ where: { store_id: storeId, period } })

      const created = await tx.reconciliation.create({
        data: {
          store_id: storeId,
          period,
          restocked_value_cents: result.restocked_value_cents,
          cogs_cents: result.cogs_cents,
          remaining_value_cents: result.remaining_value_cents,
          loss_value_cents: result.loss_value_cents,
          loss_quantity: result.loss_quantity,
          unclassified_stock_adjustment_value_cents: result.unclassified_stock_adjustment_value_cents,
          valuation_date: valuationDate,
          complete: result.complete,
          inconsistent_stock: result.inconsistent_stock,
          inputs_changed_at: inputsChangedAt ? new Date(inputsChangedAt) : null,
        },
      })

      const lossRows = [
        ...result.loss_by_reason.map(entry => ({
          reconciliation_id: created.id,
          reason: entry.reason,
          sku: null,
          quantity: entry.quantity,
          value_cents: entry.value_cents,
        })),
        ...result.loss_by_sku.map(entry => ({
          reconciliation_id: created.id,
          reason: null,
          sku: entry.sku,
          quantity: entry.quantity,
          value_cents: entry.value_cents,
        })),
        ...result.loss_by_reason_sku.map(entry => ({
          reconciliation_id: created.id,
          reason: entry.reason,
          sku: entry.sku,
          quantity: entry.quantity,
          value_cents: entry.value_cents,
        })),
      ]

      if (lossRows.length > 0) await tx.reconciliationLoss.createMany({ data: lossRows })

      if (result.unvalued.length > 0) {
        await tx.unvaluedSku.createMany({
          data: result.unvalued.map(entry => ({
            reconciliation_id: created.id,
            sku: entry.sku,
            reason: entry.reason,
            restocked: entry.restocked,
            sold: entry.sold,
            remaining: entry.remaining,
            loss_quantity: entry.loss_quantity,
          })),
        })
      }

      if (result.adjustment_flags.length > 0) {
        await tx.reconciliationAdjustment.createMany({
          data: result.adjustment_flags.map(entry => ({
            reconciliation_id: created.id,
            sku: entry.sku,
            quantity: entry.quantity,
            value_cents: entry.value_cents,
          })),
        })
      }
    })

    this.logger.log(
      `Reconciled store ${storeId} period ${period} as of ${valuationDate}: ` +
        `loss ${result.loss_value_cents} cents, adjustment ${result.unclassified_stock_adjustment_value_cents} cents, ` +
        `${result.complete ? 'complete' : `INCOMPLETE (${result.unvalued.length} unvalued, ${result.inconsistent_stock.length} inconsistent)`}`,
    )

    return this.findOne(storeId, period)
  }

  async findOne(storeId: number, period: string): Promise<ReconciliationView> {
    const found = (await this.reconciliations.findUnique({
      where: { store_id_period: { store_id: storeId, period } },
      include: { by_reason: true, unvalued: true, adjustments: true },
    })) as
      | (Reconciliation & {
          by_reason: { reason: string | null; sku: string | null; quantity: number; value_cents: number }[]
          unvalued: { sku: string; reason: string; restocked: number; sold: number; remaining: number; loss_quantity: number }[]
          adjustments: { sku: string; quantity: number; value_cents: number }[]
        })
      | null

    if (!found) {
      // Never zeroes: a month that was never reconciled is indistinguishable
      // from one with no activity if both answer with zeroes.
      throw new NotFoundException(`No reconciliation for store ${storeId} period ${period}`)
    }

    return {
      store_id: found.store_id,
      period: found.period,
      restocked_value_cents: found.restocked_value_cents,
      cogs_cents: found.cogs_cents,
      remaining_value_cents: found.remaining_value_cents,
      loss_value_cents: found.loss_value_cents,
      loss_quantity: found.loss_quantity,
      unclassified_stock_adjustment_value_cents: found.unclassified_stock_adjustment_value_cents,
      valuation_date: found.valuation_date,
      complete: found.complete,
      inconsistent_stock: found.inconsistent_stock,
      computed_at: found.computed_at,
      inputs_changed_at: found.inputs_changed_at,
      loss_by_reason: found.by_reason
        .filter(row => row.reason !== null && row.sku === null)
        .map(row => ({ reason: row.reason!, quantity: row.quantity, value_cents: row.value_cents })),
      loss_by_sku: found.by_reason
        .filter(row => row.sku !== null && row.reason === null)
        .map(row => ({ sku: row.sku!, quantity: row.quantity, value_cents: row.value_cents })),
      loss_by_reason_sku: found.by_reason
        .filter(row => row.reason !== null && row.sku !== null)
        .map(row => ({ reason: row.reason!, sku: row.sku!, quantity: row.quantity, value_cents: row.value_cents })),
      unvalued: found.unvalued.map(row => ({
        sku: row.sku,
        reason: row.reason,
        restocked: row.restocked,
        sold: row.sold,
        remaining: row.remaining,
        loss_quantity: row.loss_quantity,
      })),
      adjustment_flags: found.adjustments
        .map(row => ({ sku: row.sku, quantity: row.quantity, value_cents: row.value_cents }))
        .sort((a, b) => Math.abs(b.quantity) - Math.abs(a.quantity)),
    }
  }

  /** Every month reconciled for a store, oldest first. */
  async series(storeId: number): Promise<ReconciliationView[]> {
    const months = (await this.reconciliations.findAll({
      where: { store_id: storeId },
      orderBy: { period: 'asc' },
      select: { period: true },
    })) as { period: string }[]

    return Promise.all(months.map(month => this.findOne(storeId, month.period)))
  }

  /**
   * The network total for a month.
   *
   * Incompleteness propagates: a total containing one unpriced store is not a
   * figure anyone should act on, and the stores responsible are named so the
   * gap can be closed rather than merely noticed.
   */
  async rollup(period: string): Promise<RollupView> {
    const months = (await this.reconciliations.findAll({ where: { period } })) as Reconciliation[]

    if (months.length === 0) {
      throw new NotFoundException(`No reconciliation for period ${period}`)
    }

    const incomplete = months.filter(month => !month.complete).map(month => month.store_id)

    return {
      period,
      restocked_value_cents: months.reduce((sum, month) => sum + month.restocked_value_cents, 0),
      cogs_cents: months.reduce((sum, month) => sum + month.cogs_cents, 0),
      remaining_value_cents: months.reduce((sum, month) => sum + month.remaining_value_cents, 0),
      loss_value_cents: months.reduce((sum, month) => sum + month.loss_value_cents, 0),
      unclassified_stock_adjustment_value_cents: months.reduce(
        (sum, month) => sum + month.unclassified_stock_adjustment_value_cents,
        0,
      ),
      store_count: months.length,
      complete: incomplete.length === 0,
      incomplete_stores: incomplete,
    }
  }

  /** Merges the three movement sources into one row per SKU. */
  private mergeQuantities(
    supply: { restocks: { sku: string; quantity_restocked: number }[]; removals: { sku: string; reason: string; counts_as_loss: boolean; quantity_removed: number }[] },
    sales: { sku: string; quantity_sold: number }[],
    stock: { sku: string; closing_stock: number; inconsistent?: boolean; adjustment?: number }[],
  ): SkuQuantities[] {
    const bySku = new Map<string, SkuQuantities>()
    const ensure = (sku: string) => {
      if (!bySku.has(sku)) {
        bySku.set(sku, {
          sku,
          restocked: 0,
          sold: 0,
          remaining: 0,
          stockInconsistent: false,
          adjustment: 0,
          lossByReason: [],
        })
      }
      return bySku.get(sku)!
    }

    for (const row of supply.restocks) ensure(row.sku).restocked += row.quantity_restocked
    for (const row of sales) ensure(row.sku).sold += row.quantity_sold
    for (const row of stock) {
      const item = ensure(row.sku)
      item.remaining = row.closing_stock
      item.stockInconsistent = row.inconsistent === true
      // Read from inventory-service's already-materialised figure, not
      // re-summed from supply here: it is the same net adjustment
      // inventory-service already folded into the closing balance it derived,
      // and re-deriving it would risk the two disagreeing.
      item.adjustment = row.adjustment ?? 0
    }

    // Only loss-counting removals reach the loss figure. The classification
    // comes from supply — this service never decides what counts.
    for (const row of supply.removals) {
      if (!row.counts_as_loss) continue

      const item = ensure(row.sku)
      const existing = item.lossByReason.find(entry => entry.reason === row.reason)

      if (existing) existing.quantity += row.quantity_removed
      else item.lossByReason.push({ reason: row.reason, quantity: row.quantity_removed })
    }

    return [...bySku.values()]
  }
}

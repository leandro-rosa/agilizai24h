import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { AccountingClient } from '../clients/accounting.client'
import { ProductsClient } from '../clients/products.client'
import { MAX_COST_SYNC_ATTEMPTS, costSourceRef, dueForRetry, monthOf, sendsCost, variationBps, type CostAlert } from '../utils/cost-sync'

const DEFAULT_VARIATION_ALERT_BPS = 1000
const BATCH = 50

type SyncRow = {
  id: number
  purchase_id: number
  sku: string
  quantity: number
  received_quantity: number | null
  unit_cost_cents: number
  condition: string
  pack_quantity: number | null
  units_per_pack: number | null
  cost_sync_attempts: number
  cost_sync_attempted_at: Date | null
  purchase: { id: number; supplier_id: number; status: string; invoice_number: string | null; received_on: Date | null }
}

/**
 * The invoice cost leaves the purchase through an outbox, never inside the receipt: the receipt commits and marks each item
 * `pending`; this service sends them to products-service (`source: invoice`, vigência = the receipt day) and records what came
 * back. A failure stays visible on the item (`failed` + error) and is retried with backoff, or by hand through `retry`.
 * Sending is idempotent on the other side (`source_ref`), so a resend after a timeout creates nothing twice.
 */
@Injectable()
export class CostSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CostSyncService.name)
  private timer: NodeJS.Timeout | null = null
  private draining = false

  constructor(
    private readonly prisma: PrismaClientService,
    private readonly products: ProductsClient,
    private readonly accounting: AccountingClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const every = Number(this.config.get('COST_SYNC_INTERVAL_MS') ?? 30_000)
    if (!(every > 0)) return
    this.timer = setInterval(() => void this.drain(), every)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** What to write on an item of a received purchase: a bonus never creates a cost, anything else waits to be sent. */
  static initialState(condition: string): 'pending' | 'skipped_bonus' {
    return sendsCost(condition) ? 'pending' : 'skipped_bonus'
  }

  /** Marks items for (re)sending. Called inside the transaction that records the receipt or edits a received purchase. */
  async markItems(tx: Pick<PrismaClientService, 'purchaseItem'>, items: { id: number; condition: string }[]): Promise<void> {
    for (const item of items) {
      const state = CostSyncService.initialState(item.condition)
      await tx.purchaseItem.update({
        where: { id: item.id },
        data: { cost_sync: state, cost_sync_attempts: 0, cost_sync_attempted_at: null, cost_sync_error: null, ...(state === 'skipped_bonus' ? { cost_alerts: [] } : {}) },
      })
    }
  }

  /** Sends what is waiting; items of one purchase when `purchaseId` is given. Never throws: a failure is recorded on the item. */
  async drain(purchaseId?: number, correlationId?: string): Promise<{ sent: number; failed: number }> {
    if (this.draining && purchaseId === undefined) return { sent: 0, failed: 0 }
    this.draining = purchaseId === undefined ? true : this.draining
    const now = new Date()
    let sent = 0
    let failed = 0
    try {
      const rows = (await this.prisma.purchaseItem.findMany({
        where: { cost_sync: { in: ['pending', 'failed'] }, cost_sync_attempts: { lt: MAX_COST_SYNC_ATTEMPTS }, purchase: { status: 'received', ...(purchaseId ? { id: purchaseId } : {}) } },
        include: { purchase: true },
        orderBy: { id: 'asc' },
        take: BATCH,
      })) as SyncRow[]
      for (const row of rows) {
        if (purchaseId === undefined && !dueForRetry(row.cost_sync_attempts, row.cost_sync_attempted_at, now)) continue
        if (await this.syncItem(row, correlationId)) sent += 1
        else failed += 1
      }
    } catch (error) {
      this.logger.error(`cost sync drain failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (purchaseId === undefined) this.draining = false
    }

    return { sent, failed }
  }

  /** Puts the failed items of a purchase back in the queue (attempts reset) and sends them now. */
  async retry(purchaseId: number, correlationId?: string): Promise<{ sent: number; failed: number }> {
    await this.prisma.purchaseItem.updateMany({ where: { purchase_id: purchaseId, cost_sync: 'failed' }, data: { cost_sync: 'pending', cost_sync_attempts: 0, cost_sync_attempted_at: null } })

    return this.drain(purchaseId, correlationId)
  }

  private async syncItem(row: SyncRow, correlationId?: string): Promise<boolean> {
    const receivedOn = row.purchase.received_on?.toISOString().slice(0, 10)
    if (!receivedOn) return this.fail(row, 'purchase has no receipt date')

    const units = row.received_quantity ?? row.quantity
    // A line of a received purchase that received nothing is not a purchase: no cost is created. (The units come from the row as stored, so a partial
    // receipt that left this line at zero, or an edit that did, is caught whichever path marked it.)
    if (units <= 0) {
      await this.prisma.purchaseItem.update({ where: { id: row.id }, data: { cost_sync: 'skipped_not_received', cost_sync_attempted_at: new Date(), cost_sync_error: null, cost_alerts: [] } })
      this.logger.log(`cost sync of item ${row.id} (${row.sku}) skipped: no unit was received`)
      return true
    }
    try {
      const result = await this.products.recordInvoiceCost(
        row.sku,
        {
          effective_from: receivedOn,
          cost_cents: row.unit_cost_cents,
          supplier_id: row.purchase.supplier_id,
          purchase_id: row.purchase.id,
          purchase_item_id: row.id,
          invoice_number: row.purchase.invoice_number ?? undefined,
          source_ref: costSourceRef(row.id, row.unit_cost_cents, receivedOn),
          ...(units > 0 ? { purchase_quantity: units, purchase_total_cents: units * row.unit_cost_cents } : {}),
          ...(row.pack_quantity && row.units_per_pack ? { pack_quantity: row.pack_quantity, units_per_pack: row.units_per_pack } : {}),
        },
        correlationId,
      )

      const alerts: CostAlert[] = []
      const variation = variationBps(result.previous_cost_cents, row.unit_cost_cents)
      const limit = Number(this.config.get('COST_VARIATION_ALERT_BPS') ?? DEFAULT_VARIATION_ALERT_BPS)
      if (variation !== null && Math.abs(variation) >= limit) alerts.push('large_variation')
      if (!result.unchanged) {
        // A version dated in a closed month does not recompute that month's CMV by itself: say so.
        const status = await this.accounting.monthStatus(monthOf(receivedOn), correlationId)
        if (status === 'closed') alerts.push('closed_month')
        if (status === 'unknown') alerts.push('closed_month_unknown')
      }

      await this.prisma.purchaseItem.update({
        where: { id: row.id },
        data: {
          cost_sync: result.unchanged ? 'unchanged' : 'synced',
          cost_sync_attempts: row.cost_sync_attempts + 1,
          cost_sync_attempted_at: new Date(),
          cost_synced_at: new Date(),
          cost_sync_error: null,
          cost_version_id: result.version_id,
          cost_previous_cents: result.previous_cost_cents,
          cost_variation_bps: variation,
          cost_alerts: alerts,
        },
      })

      return true
    } catch (error) {
      return this.fail(row, error instanceof Error ? error.message : String(error))
    }
  }

  private async fail(row: SyncRow, message: string): Promise<boolean> {
    this.logger.warn(`cost sync of item ${row.id} (${row.sku}) failed: ${message}`)
    await this.prisma.purchaseItem.update({
      where: { id: row.id },
      data: { cost_sync: 'failed', cost_sync_attempts: row.cost_sync_attempts + 1, cost_sync_attempted_at: new Date(), cost_sync_error: message.slice(0, 500) },
    })

    return false
  }
}

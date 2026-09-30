import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AuditVisit, StoreMonthSales } from '../utils/audit-types'
import { readAuditBands } from '../utils/audit-config'
import { balanceBandLabels } from '../utils/bands'
import { computeBalanceAudit, type BalanceAudit } from '../utils/balance-audit'
import { ABSOLUTE_BIN_LABELS, RELATIVE_BIN_LABELS } from '../utils/distribution'
import { monthsBetween } from '../utils/months'
import { AuditSourceClient } from './audit-source.client'

export interface UnavailableStore {
  store_id: number
  /** Which read failed — the store is left out of every figure, never counted as zero. */
  reason: string
}

export interface BalanceAuditResponse extends Omit<BalanceAudit, 'gaps'> {
  presentation: {
    provisional: true
    note: string
    turnover: { high_min: number; medium_min: number }
    balance_bands: string[]
    absolute_bins: string[]
    relative_bins: string[]
  }
  gaps: BalanceAudit['gaps'] & { unavailable_stores: UnavailableStore[] }
}

const CONCURRENCY = 4

/**
 * Computes the balance-quality audit on read.
 *
 * Nothing is stored: the figures move whenever a report lands (September's
 * arrives tomorrow), and a saved copy would become one more balance that
 * disagrees with the others. It also sets no tolerance and feeds nothing else —
 * no recommendation, estimated balance or supply suggestion reads from it.
 */
@Injectable()
export class BalanceAuditService {
  private readonly logger = new Logger(BalanceAuditService.name)

  constructor(
    private readonly source: AuditSourceClient,
    private readonly config: ConfigService,
  ) {}

  async audit(from: string, to: string, correlationId?: string): Promise<BalanceAuditResponse> {
    const bands = readAuditBands(this.config)
    const months = monthsBetween(from, to)
    const storeIds = await this.source.visitStoreIds(from, to, correlationId)

    const visits: AuditVisit[] = []
    const sales: StoreMonthSales[] = []
    const unavailable: UnavailableStore[] = []

    await runPool(storeIds, CONCURRENCY, async storeId => {
      try {
        const storeVisits = await this.source.visits(storeId, from, to, correlationId)
        const storeSales: StoreMonthSales[] = []

        for (const month of months) {
          const bySku = await this.source.sales(storeId, month, correlationId)
          storeSales.push({ storeId, month, present: bySku !== null, bySku: bySku ?? new Map() })
        }

        // Added only once every read for the store succeeded, so a half-read store never leaks in.
        visits.push(...storeVisits)
        sales.push(...storeSales)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        this.logger.warn(`Audit left store ${storeId} out: ${reason}`)
        unavailable.push({ store_id: storeId, reason })
      }
    })

    const result = computeBalanceAudit({ from, to, visits, sales, bands })

    return {
      ...result,
      presentation: {
        provisional: true,
        note:
          'Bands only slice the distributions so a reader can see whether divergence depends on turnover or ' +
          'balance. They are provisional presentation cut points, not thresholds of acceptability.',
        turnover: { high_min: bands.turnover.highMin, medium_min: bands.turnover.mediumMin },
        balance_bands: balanceBandLabels(bands),
        absolute_bins: ABSOLUTE_BIN_LABELS,
        relative_bins: RELATIVE_BIN_LABELS,
      },
      gaps: { ...result.gaps, unavailable_stores: unavailable.sort((a, b) => a.store_id - b.store_id) },
    }
  }
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await worker(items[next++])
    }),
  )
}

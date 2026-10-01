import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isSynthetic } from '../../common/synthetic'
import { ParametersService } from '../parameters/parameters.service'
import { SalesClient } from '../sources/sales.client'
import { StoresClient } from '../sources/stores.client'
import { SupplyClient } from '../sources/supply.client'
import { summarizeAvailability, type AvailabilitySummary, type MonthEvidence } from './availability'
import { buildFreshness, unknownFreshness, type Freshness } from './freshness'
import { lastEndedMonth, monthsBetween, shiftMonth } from './months'

/** A probe of the sources is cheap-ish (two calls per active store per month), so reads share one for a short while. */
const PROBE_TTL_MS = 60_000
const STORES_PER_BATCH = 5
/** Active stores of a month = stores with visits in the three months before it (design D14). */
const ACTIVE_LOOKBACK_MONTHS = 3
export const DEFAULT_HISTORY_START = '2026-01'

/**
 * Looks at what the platform holds RIGHT NOW to say which months are available
 * and how an analysis compares with them. Read-only: it never writes to a source
 * and never stores anything. A failing source throws — it is never read as "no
 * data" (which would make a month look pending, or hide a lag).
 */
@Injectable()
export class FreshnessService {
  private readonly cache = new Map<string, { at: number; value: Promise<AvailabilitySummary> }>()

  constructor(
    private readonly supply: SupplyClient,
    private readonly sales: SalesClient,
    private readonly stores: StoresClient,
    private readonly parameters: ParametersService,
    private readonly config: ConfigService,
  ) {}

  /** The first month the history may start from (YYYY-MM). */
  historyStart(): string {
    return this.config.get<string>('INTELLIGENCE_HISTORY_START') ?? DEFAULT_HISTORY_START
  }

  /**
   * The latest available month newer than `after` (or since the history start when null), and the
   * ended months newer than that which are still pending import. Months are probed from the newest
   * down and the probe stops at the first available one, so a normal check costs a month or two.
   */
  async probe(after: string | null, now: Date = new Date(), correlationId?: string): Promise<AvailabilitySummary> {
    const key = `${after ?? ''}|${lastEndedMonth(now)}`
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.value

    const value = this.probeUncached(after, now, correlationId)
    this.cache.set(key, { at: Date.now(), value })
    // A failed probe must not be remembered.
    value.catch(() => this.cache.delete(key))
    if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value as string)

    return value
  }

  /** Forgets every remembered probe (tests, and anything that knows an import just happened). */
  clearCache(): void {
    this.cache.clear()
  }

  /** Same as `probe`, ignoring any remembered answer (used by the refresh trigger itself). */
  async probeFresh(after: string | null, now: Date = new Date(), correlationId?: string): Promise<AvailabilitySummary> {
    this.cache.delete(`${after ?? ''}|${lastEndedMonth(now)}`)

    return this.probe(after, now, correlationId)
  }

  /** The freshness block of something computed through `dataThrough` at `computedAt`. */
  async freshnessOf(dataThrough: string | null, computedAt: Date | null, now: Date = new Date(), correlationId?: string): Promise<Freshness> {
    if (dataThrough === null) return buildFreshness({ dataThrough: null, computedAt: null, latestAvailable: null, pendingImport: [] })

    try {
      const summary = await this.probe(dataThrough, now, correlationId)

      return buildFreshness({ dataThrough, computedAt, latestAvailable: summary.dataThrough, pendingImport: summary.pendingImport })
    } catch (error) {
      // The result is still readable; only the comparison is unavailable, and it says so.
      return unknownFreshness(dataThrough, computedAt, error instanceof Error ? error.message : String(error))
    }
  }

  private async probeUncached(after: string | null, now: Date, correlationId?: string): Promise<AvailabilitySummary> {
    const last = lastEndedMonth(now)
    const from = after === null ? this.historyStart() : shiftMonth(after, 1)
    if (from > last) return { dataThrough: null, pendingImport: [] }

    const share = (await this.parameters.current()).values.refresh.availableStoreShare
    const names = new Map((await this.stores.stores(correlationId)).map(store => [store.id, store.name]))
    const evidence: MonthEvidence[] = []

    for (const month of monthsBetween(from, last).reverse()) {
      const stores = await this.presence(month, names, correlationId)
      evidence.push({ month, stores })

      // The newest available month is all that is needed; older ones cannot change the answer.
      if (summarizeAvailability([{ month, stores }], share, now).dataThrough !== null) break
    }

    return summarizeAvailability(evidence, share, now)
  }

  private async presence(month: string, names: Map<number, string>, correlationId?: string): Promise<MonthEvidence['stores']> {
    const active = (await this.supply.visitStoreIds(shiftMonth(month, -ACTIVE_LOOKBACK_MONTHS), shiftMonth(month, -1), correlationId)).filter(id => !isSynthetic(names.get(id)))
    const out: MonthEvidence['stores'] = []

    for (let i = 0; i < active.length; i += STORES_PER_BATCH) {
      const batch = await Promise.all(
        active.slice(i, i + STORES_PER_BATCH).map(async storeId => {
          const [supply, sales] = await Promise.all([this.supply.period(storeId, month, correlationId), this.sales.period(storeId, month, correlationId)])
          return { supplyPresent: supply !== null, salesPresent: sales !== null }
        }),
      )
      out.push(...batch)
    }

    return out
  }
}

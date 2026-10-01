import { Injectable, Logger } from '@nestjs/common'
import { PrismaClientService } from '../db-client/prisma-client.service'
import type { PairResult } from '../engine/engine'
import type { Parameters } from '../parameters/parameters.types'
import { ParametersService } from '../parameters/parameters.service'
import { damageScope, networkEvidenceBySku, removalPatternInNetwork, type SkuStoreFlags } from './network-evidence'

interface StoredMonths {
  month: string
  supplyPresent: boolean
  salesPresent: boolean
}

/** A month that has fully ended before the reference date. */
export function monthEnded(month: string, asOf: Date): boolean {
  const [year, number] = month.split('-').map(Number)
  return asOf.getTime() >= Date.UTC(year, number, 1)
}

/**
 * The latest month for which supply AND sales are present at at least `share` of
 * the stores that were processed, and that has ended before the reference date.
 * Null when no month qualifies. A run never claims a month it did not read.
 */
export function dataThroughOf(stores: StoredMonths[][], share: number, rangeTo: string, asOf: Date): string | null {
  if (stores.length === 0) return null

  const months = [...new Set(stores.flatMap(store => store.map(entry => entry.month)))].filter(month => month <= rangeTo).sort()
  let through: string | null = null

  for (const month of months) {
    const present = stores.filter(store => store.some(entry => entry.month === month && entry.supplyPresent && entry.salesPresent)).length
    if (present / stores.length >= share && monthEnded(month, asOf)) through = month
  }

  return through
}

/**
 * Closes a run once every store has reported: adds the network view of each SKU
 * (needs every store, so it cannot be done per store), computes the month the
 * data really covers, and marks the run completed. Exactly one caller wins the
 * claim, so concurrent last jobs cannot finalise twice.
 */
@Injectable()
export class RunFinalizer {
  private readonly logger = new Logger(RunFinalizer.name)

  constructor(
    private readonly prisma: PrismaClientService,
    private readonly parameters: ParametersService,
  ) {}

  async finalizeIfComplete(runId: string): Promise<boolean> {
    const run = await this.prisma.engineRun.findUnique({ where: { id: runId } })
    if (!run) return false

    const reported = await this.prisma.engineRunStore.count({ where: { run_id: runId, status: { in: ['done', 'skipped'] } } })
    if (reported < run.stores_total) return false

    // One winner: only the job that flips running -> finalizing proceeds.
    const claim = await this.prisma.engineRun.updateMany({ where: { id: runId, status: { in: ['queued', 'running'] } }, data: { status: 'finalizing' } })
    if (claim.count !== 1) return false

    try {
      const version = await this.parameters.byId(run.parameter_version_id)
      await this.applyNetwork(runId, version.values)

      const done = await this.prisma.engineRunStore.findMany({ where: { run_id: runId, status: 'done' }, select: { months: true } })
      const dataThrough = dataThroughOf(
        done.map(store => (store.months ?? []) as unknown as StoredMonths[]),
        version.values.refresh.availableStoreShare,
        run.range_to,
        run.as_of,
      )

      await this.prisma.engineRun.update({ where: { id: runId }, data: { status: 'completed', data_through: dataThrough, stores_done: reported, finished_at: new Date() } })
      this.logger.log(`Run ${runId} completed: ${reported} store(s), data through ${dataThrough ?? 'no month'}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.prisma.engineRun.update({ where: { id: runId }, data: { status: 'failed', error: message, finished_at: new Date() } })
      this.logger.error(`Run ${runId} failed while finalising: ${message}`)
    }

    return true
  }

  /** Adds the cross-store evidence to every result: removal pattern in the network and the scope of damage. */
  private async applyNetwork(runId: string, p: Parameters): Promise<void> {
    const rows = await this.prisma.recommendation.findMany({ where: { run_id: runId }, select: { id: true, sku: true, store_id: true, result: true } })

    const flags = new Map<string, SkuStoreFlags[]>()
    for (const row of rows) {
      const r = row.result as unknown as PairResult
      const list = flags.get(row.sku) ?? []
      list.push({
        storeId: row.store_id,
        exposed: r.exposure.restockCount >= p.mix.minExposureCycles,
        removalPattern: r.mix.removalPatternInThisStore,
        damage: r.operation.some(alert => alert.code === 'investigate_damage'),
      })
      flags.set(row.sku, list)
    }

    const evidence = networkEvidenceBySku(flags)

    for (let i = 0; i < rows.length; i += 200) {
      await this.prisma.$transaction(
        rows.slice(i, i + 200).map(row => {
          const r = row.result as unknown as PairResult & { network?: unknown }
          const network = evidence.get(row.sku)

          if (network) {
            r.mix.networkRemovalPattern = removalPatternInNetwork(network, p.mix)
            r.network = network
            for (const alert of r.operation) if (alert.code === 'investigate_damage') alert.scope = damageScope(network)
          }

          return this.prisma.recommendation.update({ where: { id: row.id }, data: { result: r as never } })
        }),
      )
    }
  }
}

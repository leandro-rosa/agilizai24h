import { Injectable, Logger } from '@nestjs/common'
import { isSynthetic } from '../../common/synthetic'
import { BaselineRepository } from '../baseline/baseline.repository'
import { ENGINE_VERSION } from '../engine/engine'
import type { PairInput } from '../engine/engine.types'
import type { Parameters } from '../parameters/parameters.types'
import { RunInputBuilder } from '../runs/run-input.builder'
import { monthsBetween } from '../runs/runs.service'
import { StoresClient } from '../sources/stores.client'
import { SupplyClient } from '../sources/supply.client'
import { monthEnd, originsFor, type BaselineAtOrigin } from './history-view'
import { BacktestAccumulator, type BacktestReport } from './report'
import { replayPair } from './replay'
import type { PairOutcome } from './replay'

export interface BacktestRequest {
  rangeFrom: string
  rangeTo: string
  dataThrough: string
  asOf: string
  parameterVersionId: number
  correlationId?: string
}

export interface BacktestOutput {
  report: BacktestReport
  outcomes: PairOutcome[]
}

/**
 * Loads each store's history ONCE through the run input builder, derives every
 * origin by cutting it, and replays the pure engine. Read-only: it writes nothing
 * to another service and persists nothing itself (the service stores the report).
 */
@Injectable()
export class BacktestRunner {
  private readonly logger = new Logger(BacktestRunner.name)

  constructor(
    private readonly builder: RunInputBuilder,
    private readonly supply: SupplyClient,
    private readonly stores: StoresClient,
    private readonly baselines: BaselineRepository,
  ) {}

  async run(request: BacktestRequest, parameters: Parameters): Promise<BacktestOutput> {
    const limitations: string[] = [...STANDING_LIMITATIONS]

    // The data never extends past what was asked to be read: dataThrough cannot claim a month the range excludes.
    const dataThrough = request.dataThrough <= request.rangeTo ? request.dataThrough : request.rangeTo
    if (dataThrough !== request.dataThrough) limitations.push(`dataThrough ${request.dataThrough} is past the range read; it was lowered to ${dataThrough}.`)

    const months = monthsBetween(request.rangeFrom, dataThrough)
    const ctx = await this.builder.buildContext(request.rangeFrom, dataThrough, new Date(request.asOf), parameters, months, request.correlationId)

    const storeIds = await this.supply.visitStoreIds(request.rangeFrom, dataThrough, request.correlationId)
    const names = new Map((await this.stores.stores(request.correlationId)).map(store => [store.id, store.name]))
    const toRun = storeIds.filter(id => !isSynthetic(names.get(id)))
    const excluded = storeIds.length - toRun.length
    if (excluded > 0) limitations.push(`${excluded} synthetic store(s) were left out.`)

    const loaded: PairInput[][] = []
    for (const storeId of toRun) {
      try {
        const built = await this.builder.buildStore(storeId, ctx, sku => isSynthetic(ctx.catalogue.get(sku)?.name))
        loaded.push(built.inputs)
      } catch (error) {
        // A store that cannot be read is listed, never counted as "no recommendations".
        const reason = error instanceof Error ? error.message : String(error)
        limitations.push(`Store ${storeId} was skipped: ${reason}.`)
        this.logger.warn(`Backtest: store ${storeId} skipped — ${reason}`)
      }
    }

    const firstVisit = firstVisitOf(loaded)
    const origins = firstVisit ? originsFor(firstVisit, dataThrough) : []
    if (origins.length === 0) limitations.push('No origin has at least eight weeks of history: nothing was replayed.')

    const record = baselineMap(await this.baselines.currentForAll(new Date()))
    const inForce = new Map<number, Map<string, number>>()
    for (const origin of origins) inForce.set(origin.getTime(), baselineMap(await this.baselines.currentForAll(origin)))

    const baselineAt = (sku: string, origin: Date): BaselineAtOrigin => {
      const quantity = inForce.get(origin.getTime())?.get(sku)
      if (quantity !== undefined) return { quantity, ofRecord: false }
      const ofRecord = record.get(sku)
      return { quantity: ofRecord ?? null, ofRecord: ofRecord !== undefined }
    }

    const accumulator = new BacktestAccumulator(parameters, origins)
    const replayContext = { origins, endOfData: new Date(monthEnd(dataThrough) - 1), dataThrough, parameters, baselineAt }

    for (const inputs of loaded) {
      for (const input of inputs) for (const observation of replayPair(input, replayContext).observations) accumulator.add(observation)
    }

    const report = accumulator.finish({
      engineVersion: ENGINE_VERSION,
      parameterVersionId: request.parameterVersionId,
      request: { rangeFrom: request.rangeFrom, rangeTo: request.rangeTo, dataThrough, asOf: request.asOf },
      computedAt: new Date(),
      limitations,
    })

    return { report, outcomes: accumulator.outcomes }
  }
}

function firstVisitOf(stores: PairInput[][]): Date | null {
  let first = Number.POSITIVE_INFINITY
  for (const inputs of stores) for (const input of inputs) for (const visit of input.visits) first = Math.min(first, visit.endedAt.getTime())
  return Number.isFinite(first) ? new Date(first) : null
}

const baselineMap = (rows: { sku: string; quantity: number }[]) => new Map(rows.map(row => [row.sku, row.quantity]))

export const STANDING_LIMITATIONS = [
  'Cost is one current version per SKU, so margins are stated with today\'s cost, not the cost of the time.',
  'Sales and removals by reason exist only per month; loss is placed in cycles using the removals recorded at visits, an estimate.',
  'Each Product x Store is judged alone: the cross-store (network) evidence is not replayed.',
  'SKUs rejected at ingestion and conflicting baselines are not available as inputs, so those two conflicts cannot appear in the coverage split.',
  'Consumption and sales come from the same point of sale: agreement shows alignment, not what was physically on the shelf.',
  'The count-rule defaults (3 considered, 1 minimum, 45 days) are provisional; the sensitivity table does not pick between combinations.',
]

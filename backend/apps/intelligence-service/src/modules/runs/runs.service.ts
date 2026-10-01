import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { isSynthetic } from '../../common/synthetic'
import { PrismaClientService } from '../db-client/prisma-client.service'
import { ENGINE_VERSION } from '../engine/engine'
import { ParametersService } from '../parameters/parameters.service'
import { StoresClient } from '../sources/stores.client'
import { SupplyClient } from '../sources/supply.client'
import { INTELLIGENCE_QUEUES, RETRY_OPTIONS, type EngineStoreJob } from './runs.constants'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

export interface CreateRunInput {
  rangeFrom: string
  rangeTo: string
  /** ISO instant balance ages are measured from; defaults to now. */
  asOf?: string
  correlationId?: string
}

export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = []
  let [year, month] = from.split('-').map(Number)
  const [endYear, endMonth] = to.split('-').map(Number)

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`)
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }

  return months
}

/**
 * Starts engine runs and reads them back. A run is immutable once finished and
 * records the engine version and the parameter version it used, so a past result
 * can be explained with the rules in force when it was made.
 *
 * The heavy work never happens in the request: `create` records the run and
 * enqueues one job per store; `EngineStoreWorker` does the reading and computing.
 */
@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name)

  constructor(
    private readonly prisma: PrismaClientService,
    private readonly parameters: ParametersService,
    private readonly supply: SupplyClient,
    private readonly stores: StoresClient,
    private readonly broker: HoldItBullMQBroker,
  ) {}

  async create(input: CreateRunInput) {
    if (!PERIOD.test(input.rangeFrom ?? '') || !PERIOD.test(input.rangeTo ?? '') || input.rangeFrom > input.rangeTo) {
      throw new BadRequestException('rangeFrom and rangeTo are required, as YYYY-MM, with rangeFrom <= rangeTo')
    }

    const asOf = input.asOf ? new Date(input.asOf) : new Date()
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException('asOf must be an ISO date')

    const version = await this.parameters.current()
    const storeIds = await this.supply.visitStoreIds(input.rangeFrom, input.rangeTo, input.correlationId)
    const names = new Map((await this.stores.stores(input.correlationId)).map(store => [store.id, store.name]))

    const synthetic = storeIds.filter(id => isSynthetic(names.get(id)))
    const toRun = storeIds.filter(id => !synthetic.includes(id))
    const runId = randomUUID()

    await this.prisma.engineRun.create({
      data: {
        id: runId,
        status: toRun.length === 0 ? 'completed' : 'queued',
        engine_version: ENGINE_VERSION,
        parameter_version_id: version.id,
        as_of: asOf,
        range_from: input.rangeFrom,
        range_to: input.rangeTo,
        data_through: null,
        stores_total: toRun.length,
        finished_at: toRun.length === 0 ? new Date() : null,
      },
    })

    // Synthetic stores are listed, never silently dropped, and never counted as processed.
    if (synthetic.length > 0) {
      await this.prisma.engineRunStore.createMany({ data: synthetic.map(storeId => ({ run_id: runId, store_id: storeId, status: 'excluded', reason: 'synthetic' })) })
    }

    for (const storeId of toRun) {
      const job: EngineStoreJob = { schemaVersion: 1, runId, storeId, correlationId: input.correlationId }
      await this.broker.holdIt({ queueName: INTELLIGENCE_QUEUES.ENGINE_STORE, message: job, options: RETRY_OPTIONS })
    }

    this.logger.log(`Run ${runId} queued: ${toRun.length} store(s), ${synthetic.length} synthetic excluded`)

    return this.get(runId)
  }

  async list(limit = 20) {
    const runs = await this.prisma.engineRun.findMany({ orderBy: { created_at: 'desc' }, take: limit })

    return runs.map(toRunView)
  }

  async get(id: string) {
    const run = await this.prisma.engineRun.findUnique({ where: { id } })
    if (!run) throw new NotFoundException(`Run ${id} not found`)

    const [stores, summary, version] = await Promise.all([
      this.prisma.engineRunStore.findMany({ where: { run_id: id }, orderBy: { store_id: 'asc' }, select: { store_id: true, status: true, reason: true, pairs: true } }),
      this.summary(id),
      this.parameters.byId(run.parameter_version_id),
    ])

    return {
      ...toRunView(run),
      stores: stores.map(store => ({ storeId: store.store_id, status: store.status, reason: store.reason, pairs: store.pairs })),
      summary,
      /** The values the run used — still readable after newer versions exist. */
      parameters: { id: version.id, createdAt: version.createdAt, values: version.values },
    }
  }

  /** Counts per coverage category, Mix, Quantity action and tolerance status. */
  async summary(runId: string) {
    const rows = await this.prisma.recommendation.findMany({
      where: { run_id: runId },
      select: { coverage_category: true, mix: true, quantity_action: true, tolerance_status: true, releases_balance_use: true },
    })

    const count = <K extends string>(pick: (row: (typeof rows)[number]) => K) => {
      const out: Record<string, number> = {}
      for (const row of rows) out[pick(row)] = (out[pick(row)] ?? 0) + 1
      return out
    }

    return {
      pairs: rows.length,
      coverage: count(row => row.coverage_category as string),
      mix: count(row => row.mix as string),
      quantityAction: count(row => row.quantity_action as string),
      toleranceStatus: count(row => row.tolerance_status as string),
      releasesBalanceUse: rows.filter(row => row.releases_balance_use).length,
    }
  }

  async results(runId: string, filter: { storeId?: number; sku?: string; coverage?: string; limit?: number; offset?: number }) {
    await this.get(runId)

    const where = { run_id: runId, ...(filter.storeId !== undefined ? { store_id: filter.storeId } : {}), ...(filter.sku ? { sku: filter.sku } : {}), ...(filter.coverage ? { coverage_category: filter.coverage } : {}) }

    const [total, rows] = await Promise.all([
      this.prisma.recommendation.count({ where }),
      this.prisma.recommendation.findMany({ where, orderBy: [{ store_id: 'asc' }, { sku: 'asc' }], take: Math.min(filter.limit ?? 100, 1000), skip: filter.offset ?? 0 }),
    ])

    return { runId, total, results: rows.map(row => row.result) }
  }
}

function toRunView(run: {
  id: string
  status: string
  engine_version: string
  parameter_version_id: number
  as_of: Date
  range_from: string
  range_to: string
  data_through: string | null
  stores_total: number
  error: string | null
  created_at: Date
  finished_at: Date | null
}) {
  return {
    id: run.id,
    status: run.status,
    engineVersion: run.engine_version,
    parameterVersionId: run.parameter_version_id,
    asOf: run.as_of.toISOString(),
    rangeFrom: run.range_from,
    rangeTo: run.range_to,
    /** The last month the data really covers; null until the run finishes, and never a month it did not read. */
    dataThrough: run.data_through,
    storesTotal: run.stores_total,
    error: run.error,
    createdAt: run.created_at.toISOString(),
    finishedAt: run.finished_at ? run.finished_at.toISOString() : null,
  }
}

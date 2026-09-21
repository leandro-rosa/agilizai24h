import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import {
  INGESTION_QUEUES,
  type CostRowsJob,
  type SalesRowsJob,
  type SalesTransactionRow,
  type SalesTransactionsJob,
  type SupplyAdjustmentRow,
  type SupplyRecordedClosingBalanceRow,
  type SupplyRemovalRow,
  type SupplyRestockRow,
  type SupplyRowsJob,
} from '@app/ingestion-contracts'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { INTERNAL_QUEUES, RETRY_OPTIONS, type IngestionFileType } from '../constants/file-types'
import type { RestockingOperation } from '../utils/locate-restocking-operations'

export interface CreateIngestionInput {
  id: string
  fileType: IngestionFileType
  objectKey: string
  originalName: string
  /** Stated by the uploader for sales/cost; absent for supply (design D2). */
  storeId?: number
  period: string
  correlationId?: string
}

export interface RejectionInput {
  rowReference: string
  reason: string
  detail: string
}

export interface StagedRowInput {
  storeId: number
  sheetName?: string
  sku: string
  movementKind?: 'restock' | 'removal' | 'adjustment'
  reasonKey?: string
  quantity?: number
  amountCents?: number
  sourceText?: string
  recordedClosingBalance?: number
}

/** One transaction-detail row awaiting staging — see `StagedSalesTransaction` and design D1/D4. */
export interface StagedSalesTransactionInput {
  storeId: number
  sku: string
  quantity: number
  amountPaidCents: number
  result: string
  occurredAt?: Date
  originalAmountCents?: number
  discountCents?: number
  netAmountCents?: number
  coupon?: string
  method?: string
  acquirer?: string
  cardBrand?: string
  cardLastDigits?: string
  internalCode?: string
  acquirerCode?: string
  posId?: string
  machineModel?: string
  buyerNumber?: string
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name)

  constructor(
    private readonly prisma: PrismaClientService,
    private readonly broker: HoldItBullMQBroker,
  ) {}

  /**
   * Records the upload and queues the parse. Returns immediately — the request
   * that accepted the file must never wait for a workbook to be read.
   */
  async create(input: CreateIngestionInput) {
    const ingestion = await this.prisma.ingestion.create({
      data: {
        id: input.id,
        file_type: input.fileType,
        object_key: input.objectKey,
        original_name: input.originalName,
        store_id: input.storeId ?? null,
        period: input.period,
        correlation_id: input.correlationId,
        status: 'accepted',
      },
    })

    await this.broker.holdIt({
      queueName: INTERNAL_QUEUES.PARSE_FILE,
      message: { ingestionId: input.id, correlationId: input.correlationId },
      // @app/hold-it defaults to attempts: 0 — a job is tried once and dropped.
      // Parsing depends on S3 and two HTTP services, so a transient blip would
      // discard an upload with no second try. Bounded, because a genuinely
      // malformed file must reach a terminal failure rather than loop.
      options: RETRY_OPTIONS,
    })

    return ingestion
  }

  findById(id: string) {
    return this.prisma.ingestion
      .findUnique({ where: { id }, include: { rejections: { take: 100, orderBy: { id: 'asc' } } } })
      .then(found => {
        if (!found) throw new NotFoundException(`Ingestion ${id} not found`)
        return found
      })
  }

  listRecent(limit = 50) {
    return this.prisma.ingestion.findMany({ orderBy: { uploaded_at: 'desc' }, take: limit })
  }

  markProcessing(id: string, expectedChunks: number) {
    return this.prisma.ingestion.update({
      where: { id },
      data: { status: 'processing', expected_chunks: expectedChunks },
    })
  }

  markFailed(id: string, error: string) {
    this.logger.error(`Ingestion ${id} failed: ${error}`)
    return this.prisma.ingestion.update({ where: { id }, data: { status: 'failed', error } })
  }

  /**
   * Records every operation (sheet) found in a restocking workbook's pre-scan,
   * resolved or not, so later row-processing jobs can look themselves up by
   * sheet name instead of re-reading the workbook (design D2).
   */
  async recordOperations(
    ingestionId: string,
    operations: (RestockingOperation & { storeId: number | null })[],
  ): Promise<void> {
    if (operations.length === 0) return

    await this.prisma.ingestionOperation.createMany({
      data: operations.map(operation => ({
        ingestion_id: ingestionId,
        sheet_name: operation.sheetName,
        client_raw: operation.clientRaw,
        store_id: operation.storeId,
        operation_kind: operation.operationKind,
        finished_at: operation.finishedAt,
      })),
    })
  }

  operationsFor(ingestionId: string) {
    return this.prisma.ingestionOperation.findMany({ where: { ingestion_id: ingestionId } })
  }

  recordRejections(id: string, rejections: RejectionInput[]) {
    if (rejections.length === 0) return Promise.resolve()

    return this.prisma.ingestionRejection.createMany({
      data: rejections.map(rejection => ({
        ingestion_id: id,
        row_reference: rejection.rowReference,
        reason: rejection.reason,
        detail: rejection.detail,
      })),
    })
  }

  /**
   * Records a processed chunk and reports whether it was the last one.
   *
   * The increment and the read happen in one statement so two chunks finishing
   * at once cannot both see themselves as "not last" and leave the file
   * permanently unfinished — or both see themselves as last and hand the sinks
   * the batch twice.
   */
  async completeChunk(id: string, acceptedRows: number, rejectedRows: number): Promise<boolean> {
    const updated = await this.prisma.ingestion.update({
      where: { id },
      data: {
        processed_chunks: { increment: 1 },
        accepted_rows: { increment: acceptedRows },
        rejected_rows: { increment: rejectedRows },
      },
    })

    return updated.processed_chunks >= updated.expected_chunks
  }

  stageRows(id: string, rows: StagedRowInput[]) {
    if (rows.length === 0) return Promise.resolve()

    return this.prisma.stagedRow.createMany({
      data: rows.map(row => ({
        ingestion_id: id,
        store_id: row.storeId,
        sheet_name: row.sheetName ?? null,
        sku: row.sku,
        movement_kind: row.movementKind ?? null,
        reason_key: row.reasonKey ?? null,
        quantity: row.quantity ?? null,
        amount_cents: row.amountCents ?? null,
        source_text: row.sourceText ?? null,
        recorded_closing_balance: row.recordedClosingBalance ?? null,
      })),
    })
  }

  /**
   * A separate table from `stageRows` (design D1) — every network-format
   * sales row, regardless of `Resultado`, is staged here for detail. Whether
   * it ALSO reaches the aggregate via `stageRows`/`mapSalesOrCostRow` is
   * decided by the caller (`StagedRowsWorker`), based on its result.
   */
  stageSalesTransactions(id: string, rows: StagedSalesTransactionInput[]) {
    if (rows.length === 0) return Promise.resolve()

    return this.prisma.stagedSalesTransaction.createMany({
      data: rows.map(row => ({
        ingestion_id: id,
        store_id: row.storeId,
        occurred_at: row.occurredAt ?? null,
        sku: row.sku,
        quantity: row.quantity,
        amount_paid_cents: row.amountPaidCents,
        original_amount_cents: row.originalAmountCents ?? null,
        discount_cents: row.discountCents ?? null,
        net_amount_cents: row.netAmountCents ?? null,
        coupon: row.coupon ?? null,
        result: row.result,
        method: row.method ?? null,
        acquirer: row.acquirer ?? null,
        card_brand: row.cardBrand ?? null,
        card_last_digits: row.cardLastDigits ?? null,
        internal_code: row.internalCode ?? null,
        acquirer_code: row.acquirerCode ?? null,
        pos_id: row.posId ?? null,
        machine_model: row.machineModel ?? null,
        buyer_number: row.buyerNumber ?? null,
      })),
    })
  }

  /**
   * Hands the staged rows to the owning service(s) as ONE batch per period,
   * then clears the staging area.
   *
   * This is the whole reason staging exists. smartChunk splits a file into many
   * queue jobs, and the sinks replace a period wholesale — so publishing per
   * chunk would make each batch wipe the one before it, leaving only the last
   * chunk's rows. Accumulating and handing over once makes the replacement
   * contract and the chunking coexist.
   *
   * For supply, staged rows can belong to MANY stores — one restocking
   * workbook covers the whole network — so this groups by store_id and sends
   * one message per store, rather than the one message per file that sales
   * and cost still send.
   */
  async finalize(id: string): Promise<void> {
    const ingestion = await this.prisma.ingestion.findUniqueOrThrow({ where: { id } })
    const staged = await this.prisma.stagedRow.findMany({ where: { ingestion_id: id } })

    if (ingestion.file_type === 'sales') {
      await this.publishSalesByStore(id, ingestion.period, ingestion.correlation_id ?? undefined, staged)

      // Only the network-wide format ever stages anything here — an
      // old-format upload's staged_sales_transaction rows are always empty,
      // and publishSalesTransactionsByStore is a no-op for an empty list.
      const stagedTransactions = await this.prisma.stagedSalesTransaction.findMany({ where: { ingestion_id: id } })
      await this.publishSalesTransactionsByStore(id, ingestion.period, ingestion.correlation_id ?? undefined, stagedTransactions)
    }

    if (ingestion.file_type === 'supply') {
      await this.publishSupplyByStore(id, ingestion.period, ingestion.correlation_id ?? undefined, staged)
    }

    if (ingestion.file_type === 'cost') {
      const message: CostRowsJob = {
        schemaVersion: 1,
        ingestionId: id,
        correlationId: ingestion.correlation_id ?? undefined,
        storeId: ingestion.store_id!,
        period: ingestion.period,
        rows: staged.map(row => ({
          sku: row.sku,
          costCents: row.amount_cents ?? 0,
          // The period stated at upload is what the cost takes effect from —
          // a price sheet without an effective date would either overwrite
          // history or need a guess.
          effectiveFrom: `${ingestion.period}-01`,
        })),
      }
      await this.broker.holdIt({ queueName: INGESTION_QUEUES.COST_ROWS, message, options: RETRY_OPTIONS })
    }

    await this.prisma.$transaction([
      this.prisma.stagedRow.deleteMany({ where: { ingestion_id: id } }),
      this.prisma.stagedSalesTransaction.deleteMany({ where: { ingestion_id: id } }),
      this.prisma.ingestion.update({
        where: { id },
        data: {
          // Partial success is reported as partial: "it imported" must never
          // be able to mean "some of it imported".
          status: ingestion.rejected_rows > 0 ? 'partially_completed' : 'completed',
        },
      }),
    ])

    this.logger.log(
      `Finalised ingestion ${id}: ${staged.length} rows handed to ${ingestion.file_type}, ` +
        `${ingestion.rejected_rows} rejected`,
    )
  }

  /**
   * Groups staged sales rows by store and sends one `SalesRowsJob` per store,
   * summing quantity and revenue by SKU within each.
   *
   * The old, pre-aggregated per-SKU export always staged exactly one row per
   * (store, sku), so the sum below was always a no-op for it, and every
   * staged row already carried the same store_id — the ingestion's single
   * upload-time one. The network-wide, per-transaction export (Aug 2026)
   * changes both assumptions at once: it stages MANY rows for the same
   * (store, sku) — one per transaction — and those rows can belong to
   * different stores within the same ingestion, resolved per row from
   * `Cliente` (`StagedRowsWorker`).
   *
   * Summing by SKU is not an optimisation here, it is what makes the batch
   * correct: sales-service replaces a store's period with `salesRecord.
   * createMany`, and `(store_id, period, sku)` is a unique constraint there.
   * Sending the same SKU twice in one batch — which an unaggregated,
   * per-transaction file guarantees — would violate that constraint on the
   * second row and fail the whole job, rather than sum or overwrite. This
   * was a latent bug in `finalize()` itself (not sales-service, which
   * already assumes it is handed one row per SKU): it just never showed up
   * before, because the old format's export was always pre-aggregated.
   *
   * Grouping by store mirrors `publishSupplyByStore` below, for the same
   * reason: one ingestion can now span every store in the network, and each
   * still needs its own whole-period replacement.
   */
  private async publishSalesByStore(
    ingestionId: string,
    period: string,
    correlationId: string | undefined,
    staged: { store_id: number; sku: string; quantity: number | null; amount_cents: number | null }[],
  ): Promise<void> {
    if (staged.length === 0) return

    const byStore = new Map<number, typeof staged>()
    for (const row of staged) {
      if (!byStore.has(row.store_id)) byStore.set(row.store_id, [])
      byStore.get(row.store_id)!.push(row)
    }

    for (const [storeId, rows] of byStore) {
      const bySku = new Map<string, { quantity: number; amountCents: number }>()
      for (const row of rows) {
        const existing = bySku.get(row.sku) ?? { quantity: 0, amountCents: 0 }
        existing.quantity += row.quantity ?? 0
        existing.amountCents += row.amount_cents ?? 0
        bySku.set(row.sku, existing)
      }

      const message: SalesRowsJob = {
        schemaVersion: 1,
        ingestionId,
        correlationId,
        storeId,
        period,
        rows: [...bySku.entries()].map(([sku, totals]) => ({
          sku,
          quantitySold: totals.quantity,
          revenueCents: totals.amountCents,
        })),
      }

      await this.broker.holdIt({ queueName: INGESTION_QUEUES.SALES_ROWS, message, options: RETRY_OPTIONS })
    }
  }

  /**
   * Groups staged transaction-detail rows by store and sends one
   * `SalesTransactionsJob` per store — unlike `publishSalesByStore`, rows are
   * NOT summed by SKU: each staged row is already one real transaction, and
   * `sales-service`'s `SalesTransaction` table has no per-row uniqueness
   * constraint for this to violate (design D3).
   */
  private async publishSalesTransactionsByStore(
    ingestionId: string,
    period: string,
    correlationId: string | undefined,
    staged: {
      store_id: number
      occurred_at: Date | null
      sku: string
      quantity: number
      amount_paid_cents: number
      original_amount_cents: number | null
      discount_cents: number | null
      net_amount_cents: number | null
      coupon: string | null
      result: string
      method: string | null
      acquirer: string | null
      card_brand: string | null
      card_last_digits: string | null
      internal_code: string | null
      acquirer_code: string | null
      pos_id: string | null
      machine_model: string | null
      buyer_number: string | null
    }[],
  ): Promise<void> {
    if (staged.length === 0) return

    const byStore = new Map<number, typeof staged>()
    for (const row of staged) {
      if (!byStore.has(row.store_id)) byStore.set(row.store_id, [])
      byStore.get(row.store_id)!.push(row)
    }

    for (const [storeId, rows] of byStore) {
      const message: SalesTransactionsJob = {
        schemaVersion: 1,
        ingestionId,
        correlationId,
        storeId,
        period,
        rows: rows.map(
          (row): SalesTransactionRow => ({
            sku: row.sku,
            quantity: row.quantity,
            amountPaidCents: row.amount_paid_cents,
            result: row.result,
            occurredAt: row.occurred_at?.toISOString(),
            originalAmountCents: row.original_amount_cents ?? undefined,
            discountCents: row.discount_cents ?? undefined,
            netAmountCents: row.net_amount_cents ?? undefined,
            coupon: row.coupon ?? undefined,
            method: row.method ?? undefined,
            acquirer: row.acquirer ?? undefined,
            cardBrand: row.card_brand ?? undefined,
            cardLastDigits: row.card_last_digits ?? undefined,
            internalCode: row.internal_code ?? undefined,
            acquirerCode: row.acquirer_code ?? undefined,
            posId: row.pos_id ?? undefined,
            machineModel: row.machine_model ?? undefined,
            buyerNumber: row.buyer_number ?? undefined,
          }),
        ),
      }

      await this.broker.holdIt({ queueName: INGESTION_QUEUES.SALES_TRANSACTIONS, message, options: RETRY_OPTIONS })
    }
  }

  /**
   * Groups staged supply rows by store and sends one `SupplyRowsJob` per
   * store — one restocking workbook can name every store in the network, and
   * supply-service replaces a store-period wholesale, so one message must
   * never carry more than one store's rows (design D2/D8).
   */
  private async publishSupplyByStore(
    ingestionId: string,
    period: string,
    correlationId: string | undefined,
    staged: { store_id: number; sheet_name: string | null; sku: string; movement_kind: string | null; reason_key: string | null; quantity: number | null; source_text: string | null; recorded_closing_balance: number | null }[],
  ): Promise<void> {
    if (staged.length === 0) return

    const operations = await this.operationsFor(ingestionId)
    const finishedAtBySheet = new Map(operations.map(operation => [operation.sheet_name, operation.finished_at]))

    const byStore = new Map<number, typeof staged>()
    for (const row of staged) {
      if (!byStore.has(row.store_id)) byStore.set(row.store_id, [])
      byStore.get(row.store_id)!.push(row)
    }

    for (const [storeId, rows] of byStore) {
      // A store is restocked across several operations in one month (design
      // task 5.1), so every movement kind sums by its own key — never one
      // entry per row, which would either double-count or, worse, violate
      // supply-service's (store, period, sku) uniqueness outright.
      const restockBySku = new Map<string, number>()
      for (const row of rows.filter(row => row.movement_kind === 'restock')) {
        restockBySku.set(row.sku, (restockBySku.get(row.sku) ?? 0) + (row.quantity ?? 0))
      }
      const restocks: SupplyRestockRow[] = [...restockBySku.entries()].map(([sku, quantityRestocked]) => ({
        sku,
        quantityRestocked,
      }))

      const removalKey = (sku: string, reason: string) => `${sku} ${reason}`
      const removalTotals = new Map<string, { sku: string; reason: string; quantity: number; sourceText?: string }>()
      for (const row of rows.filter(row => row.movement_kind === 'removal')) {
        const key = removalKey(row.sku, row.reason_key!)
        const existing = removalTotals.get(key)

        if (existing) existing.quantity += row.quantity ?? 0
        else {
          removalTotals.set(key, {
            sku: row.sku,
            reason: row.reason_key!,
            quantity: row.quantity ?? 0,
            sourceText: row.source_text ?? undefined,
          })
        }
      }
      const removals: SupplyRemovalRow[] = [...removalTotals.values()].map(entry => ({
        sku: entry.sku,
        reason: entry.reason,
        quantityRemoved: entry.quantity,
        sourceText: entry.sourceText,
      }))

      const adjustmentBySku = new Map<string, number>()
      for (const row of rows.filter(row => row.movement_kind === 'adjustment')) {
        adjustmentBySku.set(row.sku, (adjustmentBySku.get(row.sku) ?? 0) + (row.quantity ?? 0))
      }
      // A net of zero is either the synthetic carry-forward placeholder
      // (design D5's "recorded balance with no movement") or several real
      // adjustments cancelling out — neither contributes anything to value,
      // so both are dropped the same way.
      const adjustments: SupplyAdjustmentRow[] = [...adjustmentBySku.entries()]
        .filter(([, quantity]) => quantity !== 0)
        .map(([sku, quantity]) => ({ sku, quantity }))

      // The same SKU can carry a recorded closing balance from several
      // operations within one month — the LATEST operation's reading is the
      // one that actually reflects the month's end, so earlier ones lose.
      const closingBySku = new Map<string, { quantity: number; finishedAt: Date | null }>()
      for (const row of rows) {
        if (row.recorded_closing_balance === null) continue

        const finishedAt = row.sheet_name ? (finishedAtBySheet.get(row.sheet_name) ?? null) : null
        const existing = closingBySku.get(row.sku)

        const isNewer =
          !existing ||
          (finishedAt !== null && existing.finishedAt !== null && finishedAt > existing.finishedAt) ||
          (finishedAt !== null && existing.finishedAt === null)

        if (isNewer) closingBySku.set(row.sku, { quantity: row.recorded_closing_balance, finishedAt })
      }

      const recordedClosingBalances: SupplyRecordedClosingBalanceRow[] = [...closingBySku.entries()].map(
        ([sku, entry]) => ({ sku, quantity: entry.quantity }),
      )

      const message: SupplyRowsJob = {
        schemaVersion: 1,
        ingestionId,
        correlationId,
        storeId,
        period,
        rows: [],
        restocks,
        removals,
        adjustments,
        recordedClosingBalances,
      }

      await this.broker.holdIt({ queueName: INGESTION_QUEUES.SUPPLY_ROWS, message, options: RETRY_OPTIONS })
    }
  }
}

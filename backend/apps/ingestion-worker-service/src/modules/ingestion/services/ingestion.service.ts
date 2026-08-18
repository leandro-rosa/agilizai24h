import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import {
  INGESTION_QUEUES,
  type CostRowsJob,
  type SalesRowsJob,
  type SupplyRowsJob,
} from '@app/ingestion-contracts'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { INTERNAL_QUEUES, type IngestionFileType } from '../constants/file-types'

export interface CreateIngestionInput {
  id: string
  fileType: IngestionFileType
  objectKey: string
  originalName: string
  storeId: number
  period: string
  correlationId?: string
}

export interface RejectionInput {
  rowReference: string
  reason: string
  detail: string
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
        store_id: input.storeId,
        period: input.period,
        correlation_id: input.correlationId,
        status: 'accepted',
      },
    })

    await this.broker.holdIt({
      queueName: INTERNAL_QUEUES.PARSE_FILE,
      message: { ingestionId: input.id, correlationId: input.correlationId },
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

  stageRows(
    id: string,
    rows: { sku: string; reasonKey?: string; quantity?: number; amountCents?: number; sourceText?: string }[],
  ) {
    if (rows.length === 0) return Promise.resolve()

    return this.prisma.stagedRow.createMany({
      data: rows.map(row => ({
        ingestion_id: id,
        sku: row.sku,
        reason_key: row.reasonKey ?? null,
        quantity: row.quantity ?? null,
        amount_cents: row.amountCents ?? null,
        source_text: row.sourceText ?? null,
      })),
    })
  }

  /**
   * Hands the staged rows to the owning service as ONE batch per period, then
   * clears the staging area.
   *
   * This is the whole reason staging exists. smartChunk splits a file into many
   * queue jobs, and the sinks replace a period wholesale — so publishing per
   * chunk would make each batch wipe the one before it, leaving only the last
   * chunk's rows. Accumulating and handing over once makes the replacement
   * contract and the chunking coexist.
   */
  async finalize(id: string): Promise<void> {
    const ingestion = await this.prisma.ingestion.findUniqueOrThrow({ where: { id } })
    const staged = await this.prisma.stagedRow.findMany({ where: { ingestion_id: id } })

    const envelope = {
      schemaVersion: 1 as const,
      ingestionId: id,
      correlationId: ingestion.correlation_id ?? undefined,
      storeId: ingestion.store_id,
      period: ingestion.period,
    }

    if (ingestion.file_type === 'sales') {
      const message: SalesRowsJob = {
        ...envelope,
        rows: staged.map(row => ({
          sku: row.sku,
          quantitySold: row.quantity ?? 0,
          revenueCents: row.amount_cents ?? 0,
        })),
      }
      await this.broker.holdIt({ queueName: INGESTION_QUEUES.SALES_ROWS, message })
    }

    if (ingestion.file_type === 'supply') {
      const message = {
        ...envelope,
        rows: [],
        restocks: staged
          .filter(row => row.reason_key === null && row.quantity !== null)
          .map(row => ({ sku: row.sku, quantityRestocked: row.quantity! })),
        removals: staged
          .filter(row => row.reason_key !== null)
          .map(row => ({
            sku: row.sku,
            reason: row.reason_key!,
            quantityRemoved: row.quantity ?? 0,
            sourceText: row.source_text ?? undefined,
          })),
      } as SupplyRowsJob
      await this.broker.holdIt({ queueName: INGESTION_QUEUES.SUPPLY_ROWS, message })
    }

    if (ingestion.file_type === 'cost') {
      const message: CostRowsJob = {
        ...envelope,
        rows: staged.map(row => ({
          sku: row.sku,
          costCents: row.amount_cents ?? 0,
          // The period stated at upload is what the cost takes effect from —
          // a price sheet without an effective date would either overwrite
          // history or need a guess.
          effectiveFrom: `${ingestion.period}-01`,
        })),
      }
      await this.broker.holdIt({ queueName: INGESTION_QUEUES.COST_ROWS, message })
    }

    await this.prisma.$transaction([
      this.prisma.stagedRow.deleteMany({ where: { ingestion_id: id } }),
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
}

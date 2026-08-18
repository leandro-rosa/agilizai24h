import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import type { Job } from 'bullmq'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { INTERNAL_QUEUES, type IngestionFileType } from '../constants/file-types'
import { IngestionService, type RejectionInput } from '../services/ingestion.service'
import { UpstreamClient } from '../services/upstream.client'
import { parseRemovalReasons } from '../utils/parse-removal-reasons'
import { readColumn, toCents, toQuantity } from '../utils/row-mapping'

/** What sheeter puts on the queue: one message per row, batched into jobs. */
interface SheeterRowMessage {
  rowData: Record<string, unknown>
  requestId: string
  rowId: number
  additionalData: {
    ingestionId: string
    fileType: IngestionFileType
    correlationId?: string
    worksheetName?: string
  }
}

interface StagedRowToWrite {
  sku: string
  reasonKey?: string
  quantity?: number
  amountCents?: number
  sourceText?: string
}

/**
 * Turns parsed spreadsheet rows into staged domain rows.
 *
 * Every row that cannot be processed is rejected and recorded, never skipped:
 * a skipped row produces a total that is quietly too low, with nothing to
 * indicate it. The counts it reports are what make a partially successful
 * import distinguishable from a fully successful one.
 */
@HoldItProcessor(INTERNAL_QUEUES.STAGED_ROWS)
export class StagedRowsWorker extends HoldItWorkerHost<SheeterRowMessage[] | SheeterRowMessage> {
  constructor(
    private readonly ingestions: IngestionService,
    private readonly prisma: PrismaClientService,
    private readonly upstream: UpstreamClient,
  ) {
    super()
  }

  async process(job: Job<SheeterRowMessage[] | SheeterRowMessage>): Promise<unknown> {
    const messages = Array.isArray(job.data) ? job.data : [job.data]
    if (messages.length === 0) return { accepted: 0, rejected: 0 }

    const { ingestionId, fileType, correlationId } = messages[0].additionalData
    const ingestion = await this.prisma.ingestion.findUniqueOrThrow({ where: { id: ingestionId } })

    // Resolve every product name in this chunk in one call rather than per row.
    const names = [...new Set(messages.map(message => String(readColumn(message.rowData, 'product') ?? '').trim()))]
      .filter(name => name !== '')

    const resolution = await this.upstream.resolveProductNames(names, correlationId)
    const skuByName = new Map(resolution.matched.map(match => [match.source_name, match.product.sku]))
    const unmatchedNames = new Map(resolution.unmatched.map(entry => [entry.source_name, entry.reason]))

    const toStage: StagedRowToWrite[] = []
    const rejections: RejectionInput[] = []

    for (const message of messages) {
      const reference = `${message.additionalData.worksheetName ?? 'sheet1'}!row ${message.rowId}`
      const productName = String(readColumn(message.rowData, 'product') ?? '').trim()

      if (productName === '') {
        rejections.push({ rowReference: reference, reason: 'missing_product', detail: 'The row names no product' })
        continue
      }

      const sku = skuByName.get(productName)

      if (!sku) {
        // Reported with the original name, so the operator can add an override
        // in products-service rather than guessing what the file meant.
        rejections.push({
          rowReference: reference,
          reason: unmatchedNames.get(productName) ?? 'unknown_name',
          detail: `Could not resolve product "${productName}"`,
        })
        continue
      }

      const problem = this.mapRow(fileType, sku, message.rowData, toStage)
      if (problem) rejections.push({ rowReference: reference, ...problem })
    }

    await this.ingestions.stageRows(ingestionId, toStage)
    await this.ingestions.recordRejections(ingestionId, rejections)

    const isLastChunk = await this.ingestions.completeChunk(ingestionId, toStage.length, rejections.length)

    // Only the chunk that completes the file hands the accumulated rows over,
    // as one batch — publishing per chunk would make each replace the period
    // and wipe what the previous chunks wrote.
    if (isLastChunk) await this.ingestions.finalize(ingestionId)

    this.logger.log(
      `Chunk of ingestion ${ingestionId} (${ingestion.file_type}): ` +
        `${toStage.length} staged, ${rejections.length} rejected${isLastChunk ? ' — final chunk' : ''}`,
    )

    return { accepted: toStage.length, rejected: rejections.length, finalized: isLastChunk }
  }

  /** Returns a rejection when the row cannot be mapped, or undefined on success. */
  private mapRow(
    fileType: IngestionFileType,
    sku: string,
    rowData: Record<string, unknown>,
    into: StagedRowToWrite[],
  ): Omit<RejectionInput, 'rowReference'> | undefined {
    if (fileType === 'sales') {
      const quantity = toQuantity(readColumn(rowData, 'quantity'))
      const amountCents = toCents(readColumn(rowData, 'amount'))

      if (quantity === null) {
        return { reason: 'unreadable_quantity', detail: 'The sold quantity is missing or unreadable' }
      }

      into.push({ sku, quantity, amountCents: amountCents ?? 0 })
      return undefined
    }

    if (fileType === 'cost') {
      const amountCents = toCents(readColumn(rowData, 'cost'))

      if (amountCents === null) {
        // Never defaulted to zero: a cost the file could not express must be
        // reported, since a zero cost silently understates COGS and loss.
        return { reason: 'unreadable_cost', detail: 'The cost is missing or unreadable' }
      }

      into.push({ sku, amountCents })
      return undefined
    }

    // supply: a restock quantity, plus removals split per reason.
    const restocked = toQuantity(readColumn(rowData, 'restocked'))
    if (restocked !== null) into.push({ sku, quantity: restocked })

    const removalText = readColumn(rowData, 'removals')
    const reportedTotal = toQuantity(readColumn(rowData, 'removedTotal'))
    const parsed = parseRemovalReasons(
      removalText === undefined ? null : String(removalText),
      reportedTotal ?? undefined,
    )

    if (!parsed.ok) {
      return { reason: parsed.reason, detail: parsed.detail }
    }

    for (const entry of parsed.quantities) {
      into.push({
        sku,
        reasonKey: entry.reasonKey,
        quantity: entry.quantity,
        sourceText: removalText === undefined ? undefined : String(removalText),
      })
    }

    if (restocked === null && parsed.quantities.length === 0) {
      return { reason: 'empty_row', detail: 'The row has neither a restock quantity nor any removal' }
    }

    return undefined
  }
}

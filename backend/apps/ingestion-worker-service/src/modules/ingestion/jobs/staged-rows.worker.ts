import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import type { Job } from 'bullmq'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { INTERNAL_QUEUES, type IngestionFileType } from '../constants/file-types'
import { IngestionService, type RejectionInput, type StagedRowInput } from '../services/ingestion.service'
import { UpstreamClient } from '../services/upstream.client'
import { checkBalanceIdentity } from '../utils/check-balance-identity'
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

/** Sheets resolved during the pre-scan, keyed by name — supply rows only. */
interface ResolvedOperation {
  sheetName: string
  storeId: number
  operationKind: string
}

/**
 * Turns parsed spreadsheet rows into staged domain rows.
 *
 * Every row that cannot be processed is rejected and recorded, never skipped:
 * a skipped row produces a total that is quietly too low, with nothing to
 * indicate it. The counts it reports are what make a partially successful
 * import distinguishable from a fully successful one.
 *
 * The one exception is a row from a sheet the pre-scan already rejected
 * (`locateRestockingOperations` found no operation header, no product table,
 * an unrecognised kind, or an unresolved store) — that sheet already has ONE
 * clear rejection recorded in `parse-file.worker.ts`. `smartChunk` still
 * enqueues its rows regardless (it has no per-sheet filter), so without this
 * they would each produce a second, noisier rejection repeating the same
 * cause. They are silently dropped here instead.
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

    const operationsBySheet =
      fileType === 'supply' ? await this.loadResolvedOperations(ingestionId) : new Map<string, ResolvedOperation>()

    const relevantMessages =
      fileType === 'supply'
        ? messages.filter(message => operationsBySheet.has(message.additionalData.worksheetName ?? ''))
        : messages

    if (relevantMessages.length === 0) {
      const isLastChunk = await this.ingestions.completeChunk(ingestionId, 0, 0)
      if (isLastChunk) await this.ingestions.finalize(ingestionId)
      return { accepted: 0, rejected: 0, finalized: isLastChunk }
    }

    const { skuByCode, unmatchedCodeReasons, skuByName, unmatchedNameReasons } = await this.resolveProducts(
      relevantMessages,
      correlationId,
    )

    const toStage: StagedRowInput[] = []
    const rejections: RejectionInput[] = []

    for (const message of relevantMessages) {
      const reference = `${message.additionalData.worksheetName ?? 'sheet1'}!row ${message.rowId}`
      const operation =
        fileType === 'supply' ? operationsBySheet.get(message.additionalData.worksheetName ?? '') : undefined

      const code = String(readColumn(message.rowData, 'productCode') ?? '').trim()
      const productName = String(readColumn(message.rowData, 'product') ?? '').trim()

      // Code-first (design D3): a stated code that is wrong is never silently
      // re-resolved by name — that would let a mistyped code slip through
      // under whatever the name happens to match.
      let sku: string | undefined
      let productProblem: Omit<RejectionInput, 'rowReference'> | undefined

      if (code !== '') {
        sku = skuByCode.get(code)
        if (!sku) {
          productProblem = {
            reason: unmatchedCodeReasons.get(code) ?? 'unknown_sku',
            detail: `Could not resolve product code "${code}"`,
          }
        }
      } else if (productName !== '') {
        sku = skuByName.get(productName)
        if (!sku) {
          productProblem = {
            reason: unmatchedNameReasons.get(productName) ?? 'unknown_name',
            detail: `Could not resolve product "${productName}"`,
          }
        }
      } else {
        productProblem = { reason: 'missing_product', detail: 'The row names no product code or name' }
      }

      if (productProblem) {
        rejections.push({ rowReference: reference, ...productProblem })
        continue
      }

      const problem =
        fileType === 'supply'
          ? this.mapSupplyRow(sku!, message.rowData, operation!, toStage)
          : this.mapSalesOrCostRow(fileType, sku!, ingestion.store_id!, message.rowData, toStage)

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

  /** Sheets the pre-scan resolved to a real store — see the class doc for what happens to the rest. */
  private async loadResolvedOperations(ingestionId: string): Promise<Map<string, ResolvedOperation>> {
    const operations = await this.ingestions.operationsFor(ingestionId)

    return new Map(
      operations
        .filter((operation): operation is typeof operation & { store_id: number } => operation.store_id !== null)
        .map(operation => [
          operation.sheet_name,
          { sheetName: operation.sheet_name, storeId: operation.store_id, operationKind: operation.operation_kind },
        ]),
    )
  }

  /** Resolves every product in this chunk in two batches — by code, then by name for what has none. */
  private async resolveProducts(
    messages: SheeterRowMessage[],
    correlationId?: string,
  ): Promise<{
    skuByCode: Map<string, string>
    unmatchedCodeReasons: Map<string, string>
    skuByName: Map<string, string>
    unmatchedNameReasons: Map<string, string>
  }> {
    const codeOf = (message: SheeterRowMessage) => String(readColumn(message.rowData, 'productCode') ?? '').trim()
    const nameOf = (message: SheeterRowMessage) => String(readColumn(message.rowData, 'product') ?? '').trim()

    const codes = [...new Set(messages.map(codeOf))].filter(code => code !== '')
    const namesNeedingFallback = [...new Set(messages.filter(message => codeOf(message) === '').map(nameOf))].filter(
      name => name !== '',
    )

    const [codeResolution, nameResolution] = await Promise.all([
      codes.length > 0
        ? this.upstream.resolveSkus(codes, correlationId)
        : Promise.resolve({ matched: [], unmatched: [] }),
      namesNeedingFallback.length > 0
        ? this.upstream.resolveProductNames(namesNeedingFallback, correlationId)
        : Promise.resolve({ matched: [], unmatched: [] }),
    ])

    return {
      skuByCode: new Map(codeResolution.matched.map(product => [product.sku, product.sku])),
      unmatchedCodeReasons: new Map(codeResolution.unmatched.map(entry => [entry.sku, entry.reason])),
      skuByName: new Map(nameResolution.matched.map(match => [match.source_name, match.product.sku])),
      unmatchedNameReasons: new Map(nameResolution.unmatched.map(entry => [entry.source_name, entry.reason])),
    }
  }

  private mapSalesOrCostRow(
    fileType: 'sales' | 'cost',
    sku: string,
    storeId: number,
    rowData: Record<string, unknown>,
    into: StagedRowInput[],
  ): Omit<RejectionInput, 'rowReference'> | undefined {
    if (fileType === 'sales') {
      const quantity = toQuantity(readColumn(rowData, 'quantity'))
      const amountCents = toCents(readColumn(rowData, 'amount'))

      if (quantity === null) {
        return { reason: 'unreadable_quantity', detail: 'The sold quantity is missing or unreadable' }
      }

      into.push({ storeId, sku, quantity, amountCents: amountCents ?? 0 })
      return undefined
    }

    const amountCents = toCents(readColumn(rowData, 'cost'))

    if (amountCents === null) {
      // Never defaulted to zero: a cost the file could not express must be
      // reported, since a zero cost silently understates COGS and loss.
      return { reason: 'unreadable_cost', detail: 'The cost is missing or unreadable' }
    }

    into.push({ storeId, sku, amountCents })
    return undefined
  }

  /**
   * A restock quantity, removals split per reason, and the inventory
   * adjustment — the three movement kinds a restocking row can carry, plus the
   * operators' own recorded closing balance for the cross-check `finalize()`
   * resolves across every operation for the store-period.
   */
  private mapSupplyRow(
    sku: string,
    rowData: Record<string, unknown>,
    operation: ResolvedOperation,
    into: StagedRowInput[],
  ): Omit<RejectionInput, 'rowReference'> | undefined {
    const opening = toQuantity(readColumn(rowData, 'openingBalance')) ?? 0
    const restocked = toQuantity(readColumn(rowData, 'restocked'))
    const removedTotal = toQuantity(readColumn(rowData, 'removedTotal')) ?? 0
    const adjustment = toQuantity(readColumn(rowData, 'adjustment')) ?? 0
    const recordedClosing = toQuantity(readColumn(rowData, 'recordedClosingBalance'))

    if (recordedClosing === null) {
      return { reason: 'unreadable_closing_balance', detail: 'Qtd. final is missing or unreadable' }
    }

    // The row's own arithmetic must hold — a disagreement means the row was
    // mis-read, not that the export is wrong (measured on 89,252 real rows).
    const identity = checkBalanceIdentity({
      opening,
      restocked: restocked ?? 0,
      removedTotal,
      adjustment,
      recordedClosing,
    })

    if (!identity.ok) {
      return {
        reason: 'balance_mismatch',
        detail:
          `Qtd. Anterior + Qtd. abastecida + Remoções + Diferença = ${identity.expected}, ` +
          `but Qtd. final reports ${identity.recorded}`,
      }
    }

    // Never observed in the real export, and never expected: a restocking-only
    // operation carrying an adjustment is a data shape the design does not
    // recognise, so it fails loudly rather than being silently accumulated.
    if (operation.operationKind === 'restocking' && adjustment !== 0) {
      return {
        reason: 'unexpected_adjustment',
        detail: `A restocking-kind operation carried a non-zero adjustment (${adjustment}) for this product`,
      }
    }

    const removalText = readColumn(rowData, 'removalDetail')
    const parsed = parseRemovalReasons(removalText === undefined ? null : String(removalText), removedTotal)

    if (!parsed.ok) {
      return { reason: parsed.reason, detail: parsed.detail }
    }

    const rows: StagedRowInput[] = []

    if (restocked !== null) {
      rows.push({ storeId: operation.storeId, sheetName: operation.sheetName, sku, movementKind: 'restock', quantity: restocked })
    }

    for (const entry of parsed.quantities) {
      rows.push({
        storeId: operation.storeId,
        sheetName: operation.sheetName,
        sku,
        movementKind: 'removal',
        reasonKey: entry.reasonKey,
        quantity: entry.quantity,
        sourceText: removalText === undefined ? undefined : String(removalText),
      })
    }

    if (adjustment !== 0) {
      rows.push({ storeId: operation.storeId, sheetName: operation.sheetName, sku, movementKind: 'adjustment', quantity: adjustment })
    }

    if (rows.length === 0) {
      // A pure carry-forward row: no movement of any kind, but the recorded
      // balance is still worth keeping for the cross-check — staged as a
      // zero-quantity adjustment so it is not silently discarded.
      rows.push({ storeId: operation.storeId, sheetName: operation.sheetName, sku, movementKind: 'adjustment', quantity: 0 })
    }

    // The recorded closing balance is carried on exactly one row, so
    // `finalize()`'s per-SKU pick sees it once per operation, not once per
    // movement produced by the same row.
    rows[rows.length - 1].recordedClosingBalance = recordedClosing
    into.push(...rows)

    return undefined
  }
}

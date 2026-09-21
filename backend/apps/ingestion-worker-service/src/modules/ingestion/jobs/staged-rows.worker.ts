import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import type { Job } from 'bullmq'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { INTERNAL_QUEUES, type IngestionFileType } from '../constants/file-types'
import {
  IngestionService,
  type RejectionInput,
  type StagedRowInput,
  type StagedSalesTransactionInput,
} from '../services/ingestion.service'
import { UpstreamClient } from '../services/upstream.client'
import { checkBalanceIdentity } from '../utils/check-balance-identity'
import { parseRemovalReasons } from '../utils/parse-removal-reasons'
import { hasColumn, readColumn, toCents, toExcelDate, toQuantity } from '../utils/row-mapping'

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
 *
 * The network-wide sales format (Aug 2026) adds two more per-row checks,
 * upstream of product resolution: `Resultado` must read `'OK'` (anything
 * else is a real rejection, `not_ok_result`, never a silent drop), and
 * `Cliente` must resolve to a registered store (`unresolved_store`) — one
 * resolution call per distinct `Cliente` value in the chunk, the same
 * batching `parse-file.worker.ts`'s `prepareRestockingFile` already uses for
 * restocking's per-sheet store. The old format needs neither: it has no
 * `Resultado` column, and its store is the ingestion's single upload-time
 * `store_id`.
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

    const rejections: RejectionInput[] = []

    // The network-wide sales format (Aug 2026) carries the store per row
    // (`Cliente`), rather than the ingestion's single upload-time store_id —
    // detected the same way parse-file.worker.ts detects it, by the presence
    // of that column. Every message in a chunk shares the same file's
    // headers, so checking the first one is enough.
    const isNetworkSales = fileType === 'sales' && hasColumn(Object.keys(relevantMessages[0].rowData), 'clientStore')

    const salesMessages = relevantMessages
    const storeIdByClient = new Map<string, number | null>()

    if (isNetworkSales) {
      // One resolution call per distinct Cliente value in the chunk, not per
      // row — same batching prepareRestockingFile already uses for
      // restocking's per-sheet store. Resolved for EVERY relevant message,
      // not only 'OK' ones (add-sales-transaction-detail design D4): a
      // declined or cancelled row is still staged for transaction detail
      // when its store and product resolve, so resolution cannot be skipped
      // for it anymore.
      const distinctClients = [
        ...new Set(relevantMessages.map(message => String(readColumn(message.rowData, 'clientStore') ?? '').trim())),
      ].filter(client => client !== '')

      for (const clientRaw of distinctClients) {
        const store = await this.upstream.resolveStoreByExternalCode(clientRaw, correlationId)
        storeIdByClient.set(clientRaw, store?.id ?? null)
      }
    }

    const { skuByCode, unmatchedCodeReasons, skuByName, unmatchedNameReasons } = await this.resolveProducts(
      salesMessages,
      correlationId,
    )

    const toStage: StagedRowInput[] = []
    const toStageTransactions: StagedSalesTransactionInput[] = []

    for (const message of salesMessages) {
      const reference = `${message.additionalData.worksheetName ?? 'sheet1'}!row ${message.rowId}`
      const operation =
        fileType === 'supply' ? operationsBySheet.get(message.additionalData.worksheetName ?? '') : undefined

      let networkStoreId: number | null = null
      let networkResult: string | null = null

      if (isNetworkSales) {
        networkResult = String(readColumn(message.rowData, 'result') ?? '').trim()

        // Only a real 'OK' counts as a sale for the aggregate — any other
        // outcome (a cancelled or reversed transaction, in this export) is
        // excluded from it and reported here, exactly as before this row
        // could also be staged for transaction detail. The two are no
        // longer exclusive: this rejection is recorded regardless of
        // whether the row goes on to resolve and be staged below.
        if (networkResult.toUpperCase() !== 'OK') {
          rejections.push({
            rowReference: reference,
            reason: 'not_ok_result',
            detail: `Resultado is "${networkResult || '(blank)'}", not "OK"`,
          })
        }

        const clientRaw = String(readColumn(message.rowData, 'clientStore') ?? '').trim()
        networkStoreId = clientRaw !== '' ? (storeIdByClient.get(clientRaw) ?? null) : null

        if (networkStoreId === null) {
          // An unresolved store means nothing further can be done with this
          // row — no transaction detail either. A non-OK row that also
          // fails here gets exactly the one rejection above, never a second.
          if (networkResult.toUpperCase() === 'OK') {
            rejections.push({
              rowReference: reference,
              reason: 'unresolved_store',
              detail:
                clientRaw === ''
                  ? 'The row names no store (Cliente is blank)'
                  : `"${clientRaw}" matches no registered store`,
            })
          }
          continue
        }
      }

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
        // Same rule as the unresolved-store case above: a non-OK row whose
        // product also fails to resolve gets only its not_ok_result rejection.
        if (!isNetworkSales || networkResult!.toUpperCase() === 'OK') {
          rejections.push({ rowReference: reference, ...productProblem })
        }
        continue
      }

      if (isNetworkSales) {
        // Staged for detail regardless of result — the whole point of
        // keeping declined/cancelled transactions is computing an approval
        // rate later, which needs them distinguishable from completed
        // sales, not absent. Never staged when quantity is unreadable: an
        // OK row in that state gets mapSalesOrCostRow's own
        // 'unreadable_quantity' rejection below, and a non-OK row already
        // has its not_ok_result rejection — neither needs a fabricated
        // quantity to go with it.
        const transactionRow = this.buildTransactionDetail(sku!, networkStoreId!, networkResult!, message.rowData)
        if (transactionRow) toStageTransactions.push(transactionRow)

        if (networkResult!.toUpperCase() !== 'OK') continue
      }

      const problem =
        fileType === 'supply'
          ? this.mapSupplyRow(sku!, message.rowData, operation!, toStage)
          : this.mapSalesOrCostRow(fileType, sku!, networkStoreId ?? ingestion.store_id!, message.rowData, toStage)

      if (problem) rejections.push({ rowReference: reference, ...problem })
    }

    await this.ingestions.stageRows(ingestionId, toStage)
    await this.ingestions.stageSalesTransactions(ingestionId, toStageTransactions)
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
   * Builds one transaction-detail row for the network-wide sales format,
   * regardless of `result` — staged for every resolvable row, not only
   * completed sales (design D4). Returns `undefined` (never staged, no
   * rejection of its own) when the quantity is unreadable: an OK row in
   * that state gets `mapSalesOrCostRow`'s own `unreadable_quantity`
   * rejection right after this is called, and a non-OK row already has its
   * `not_ok_result` rejection — neither needs a fabricated quantity.
   */
  private buildTransactionDetail(
    sku: string,
    storeId: number,
    result: string,
    rowData: Record<string, unknown>,
  ): StagedSalesTransactionInput | undefined {
    const quantity = toQuantity(readColumn(rowData, 'quantity'))
    if (quantity === null) return undefined

    const amountPaidCents = toCents(readColumn(rowData, 'amount')) ?? 0
    const originalAmountCents = toCents(readColumn(rowData, 'originalAmount'))
    const discountCents = toCents(readColumn(rowData, 'discount'))
    const netAmountCents = toCents(readColumn(rowData, 'netAmount'))
    const occurredAt = toExcelDate(readColumn(rowData, 'occurredAt'))

    const text = (key: Parameters<typeof readColumn>[1]) => {
      const value = readColumn(rowData, key)
      const trimmed = value === undefined ? '' : String(value).trim()
      return trimmed === '' ? undefined : trimmed
    }

    return {
      storeId,
      sku,
      quantity,
      amountPaidCents,
      result,
      occurredAt: occurredAt ?? undefined,
      originalAmountCents: originalAmountCents ?? undefined,
      discountCents: discountCents ?? undefined,
      netAmountCents: netAmountCents ?? undefined,
      coupon: text('coupon'),
      method: text('paymentMethod'),
      acquirer: text('acquirer'),
      cardBrand: text('cardBrand'),
      cardLastDigits: text('cardLastDigits'),
      internalCode: text('internalCode'),
      acquirerCode: text('acquirerCode'),
      posId: text('posId'),
      machineModel: text('machineModel'),
      buyerNumber: text('buyerNumber'),
    }
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

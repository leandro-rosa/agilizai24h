import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import { S3Service } from '@app/aws'
import { SheeterProcessorService } from '@app/sheeter'
import type { Job } from 'bullmq'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { INTERNAL_QUEUES, REQUIRED_HEADERS, type IngestionFileType } from '../constants/file-types'
import { IngestionService } from '../services/ingestion.service'
import { UpstreamClient } from '../services/upstream.client'
import { hasRawColumn, type ColumnKey } from '../utils/row-mapping'
import { locateRestockingOperations } from '../utils/locate-restocking-operations'
import { readWorkbookRows } from '../utils/read-workbook-rows'

interface ParseFileJob {
  ingestionId: string
  correlationId?: string
}

/** Which columns each file type cannot be read without. Not used for `supply` — see REQUIRED_HEADERS. */
const REQUIRED_COLUMNS: Record<Exclude<IngestionFileType, 'supply'>, ColumnKey[]> = {
  sales: ['product', 'quantity'],
  cost: ['product', 'cost'],
}

/**
 * Which columns the NEW, network-wide, per-transaction sales format (Aug
 * 2026 POS export capability) cannot be read without — a separate list from
 * `REQUIRED_COLUMNS.sales`, since this format carries per-row store identity
 * (`clientStore`) and a per-transaction outcome (`result`) the old,
 * pre-aggregated per-SKU export never had.
 */
const NETWORK_SALES_REQUIRED_COLUMNS: ColumnKey[] = ['clientStore', 'product', 'quantity', 'result']
const NETWORK_SALES_REQUIRED_HEADERS = ['Cliente', 'Descrição Produto', 'Quantidade', 'Resultado']

/**
 * Downloads an uploaded workbook and hands it to sheeter for chunking.
 *
 * Sales and cost keep the original flat-table path: validate the declared
 * type against row-1 headers BEFORE chunking, so a structural mismatch fails
 * once rather than producing thousands of failing row jobs, then
 * `smartChunk({headersRow:[1]})`.
 *
 * Supply (restocking) is structurally different — a multi-sheet workbook
 * covering every store in the month, with a two-block layout per sheet (see
 * design "Context") — so it takes its own path: a pre-scan locates every
 * sheet's operation (store, kind) and its product table's actual header row,
 * BEFORE any product row is read. `smartChunk` still does the row chunking
 * once that shared header row is known — see design D8 for why reusing it
 * works despite the multi-sheet layout.
 *
 * Sales has a THIRD path since Aug 2026: the POS export gained a
 * network-wide, per-transaction report covering every store for the month,
 * detected by its `clientStore` (`Cliente`) column — the old, pre-aggregated
 * per-SKU export never carried one. Structurally it is still a flat table
 * (header at row 1), so it reuses `smartChunk` the same way as the old
 * format; only the required columns and, in `StagedRowsWorker`, how each
 * row's store is resolved, differ. Both formats are supported going
 * forward — the old one is never removed.
 */
@HoldItProcessor(INTERNAL_QUEUES.PARSE_FILE)
export class ParseFileWorker extends HoldItWorkerHost<ParseFileJob> {
  constructor(
    private readonly ingestions: IngestionService,
    private readonly prisma: PrismaClientService,
    private readonly s3: S3Service,
    private readonly sheeter: SheeterProcessorService,
    private readonly upstream: UpstreamClient,
  ) {
    super()
  }

  async process(job: Job<ParseFileJob>): Promise<unknown> {
    const { ingestionId, correlationId } = job.data
    const ingestion = await this.prisma.ingestion.findUniqueOrThrow({ where: { id: ingestionId } })
    const fileType = ingestion.file_type as IngestionFileType

    let workDir: string | undefined

    try {
      // The file is the evidence: it stays in object storage untouched, and a
      // copy is written to a temp path only because sheeter reads paths.
      const { body } = await this.s3.getFile(ingestion.object_key)

      workDir = await mkdtemp(join(tmpdir(), 'agiliz-ingestion-'))
      const filePath = join(workDir, ingestion.original_name.replace(/[^\w.-]/g, '_'))
      await writeFile(filePath, body)

      // The new (Aug 2026) network-wide, per-transaction sales format is
      // detected by the presence of the `clientStore` (Cliente) column, which
      // the old, pre-aggregated per-SKU export never carried — that export
      // has no store identity of its own (design D2 of
      // align-ingestion-with-real-reports still applies: the OLD format keeps
      // asking for the store at upload).
      const isNetworkSales = fileType === 'sales' && (await this.isNetworkSalesFile(filePath))

      // The old sales format has no store identity of its own anywhere in the
      // file — it depends entirely on the upload-time store_id (design D2).
      // The DTO no longer requires that field for `sales` (network uploads
      // legitimately have none), so a plain old-format file uploaded without
      // one must fail loudly here, rather than staging rows with no store and
      // hitting a NOT NULL failure downstream.
      if (fileType === 'sales' && !isNetworkSales && ingestion.store_id === null) {
        throw new Error(
          'This looks like the old, single-store sales format (no Cliente column) — a store must be selected at upload for it.',
        )
      }

      const headersRow =
        fileType === 'supply'
          ? await this.prepareRestockingFile(ingestionId, filePath, correlationId)
          : isNetworkSales
            ? await this.prepareNetworkSalesFile(filePath)
            : await this.prepareFlatFile(filePath, fileType)

      if (headersRow === null) {
        // Every sheet in a restocking workbook failed to parse — nothing to
        // chunk. Recorded as rejections already; the ingestion itself is
        // marked failed so it does not sit at "processing" forever.
        throw new Error('No recognisable restocking operation was found in this workbook')
      }

      const { jobs } = await this.sheeter.smartChunk({
        filePath,
        requestId: ingestionId,
        queueCallbackName: INTERNAL_QUEUES.STAGED_ROWS,
        additionalData: { ingestionId, fileType, correlationId },
        headersRow: [headersRow],
      })

      // Recorded before any chunk can finish, so the completion check has the
      // real target to compare against.
      await this.ingestions.markProcessing(ingestionId, jobs.length)

      if (jobs.length === 0) {
        // An empty file still marks the period ingested, which is what keeps
        // "never uploaded" distinct from "uploaded and empty".
        await this.ingestions.finalize(ingestionId)
      }

      this.logger.log(`Chunked ingestion ${ingestionId} into ${jobs.length} row job(s)`)

      return { chunks: jobs.length }
    } catch (error) {
      await this.ingestions.markFailed(ingestionId, (error as Error).message)
      throw error
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** Sales and cost: single flat table, header at row 1. Returns the header row for smartChunk. */
  private async prepareFlatFile(filePath: string, fileType: Exclude<IngestionFileType, 'supply'>): Promise<number> {
    await this.assertHeadersMatchType(filePath, fileType)
    return 1
  }

  /**
   * The new (Aug 2026) network-wide, per-transaction sales format — a single
   * flat table like the old sales export, header at row 1, so it reuses
   * `smartChunk` the same way. Only the required columns differ: store
   * identity now lives per row (`clientStore`/`Cliente`) instead of at
   * upload, and a per-transaction outcome (`result`/`Resultado`) exists to
   * filter. Store resolution itself happens per chunk in
   * `StagedRowsWorker`, not here — unlike restocking, where every store is
   * known upfront from the sheet-level pre-scan.
   */
  private async prepareNetworkSalesFile(filePath: string): Promise<number> {
    const headers = await this.readHeaderRow(filePath)
    const missing = NETWORK_SALES_REQUIRED_COLUMNS.filter(column => !hasRawColumn(headers, column))

    if (missing.length > 0) {
      throw new Error(
        `This does not look like a network-wide sales report: missing column(s) ${missing.join(', ')}. ` +
          `Expected something matching: ${NETWORK_SALES_REQUIRED_HEADERS.join(', ')}. Found: ${headers.join(', ')}`,
      )
    }

    return 1
  }

  /**
   * Restocking: locates every sheet's operation and its product table, resolves
   * each operation's store, and records both — successes and failures — before
   * any product row is chunked.
   *
   * Returns the shared product-header row every sheet must have agreed on, for
   * `smartChunk`'s single `headersRow`. An operation whose STORE fails to
   * resolve is still recorded (with a null store) and still chunked — its rows
   * are rejected individually downstream, by StagedRowsWorker, rather than
   * failing sibling operations that resolved fine (design task 4.3).
   */
  private async prepareRestockingFile(
    ingestionId: string,
    filePath: string,
    correlationId?: string,
  ): Promise<number | null> {
    const sheets = await readWorkbookRows(filePath)
    const located = locateRestockingOperations(sheets)

    if (located.inconsistentHeaderRows) {
      throw new Error(
        'This workbook\'s sheets locate the product table at different rows — refusing to guess which is right. ' +
          `Rows found: ${[...new Set(located.operations.map(o => o.productHeaderRowNumber))].join(', ')}`,
      )
    }

    if (located.missingRequiredColumns.length > 0) {
      throw new Error(
        `This does not look like a restocking report: missing column(s) ${located.missingRequiredColumns.join(', ')}.`,
      )
    }

    await this.ingestions.recordRejections(
      ingestionId,
      located.unparseableSheets.map(sheet => ({
        rowReference: sheet.sheetName,
        reason: 'unparseable_sheet',
        detail: sheet.reason,
      })),
    )

    if (located.operations.length === 0) return null

    // One resolution call per distinct store name, not per operation — a
    // workbook can carry the same store across several sheets in one month.
    const distinctClients = [...new Set(located.operations.map(operation => operation.clientRaw))]
    const resolutions = new Map<string, number | null>()

    for (const clientRaw of distinctClients) {
      const store = await this.upstream.resolveStoreByExternalCode(clientRaw, correlationId)
      resolutions.set(clientRaw, store?.id ?? null)
    }

    const unresolvedClients = distinctClients.filter(clientRaw => resolutions.get(clientRaw) === null)

    await this.ingestions.recordRejections(
      ingestionId,
      located.operations
        .filter(operation => resolutions.get(operation.clientRaw) === null)
        .map(operation => ({
          rowReference: operation.sheetName,
          reason: 'unresolved_store',
          detail: `"${operation.clientRaw}" matches no registered store`,
        })),
    )

    await this.ingestions.recordOperations(
      ingestionId,
      located.operations.map(operation => ({ ...operation, storeId: resolutions.get(operation.clientRaw) ?? null })),
    )

    if (unresolvedClients.length > 0) {
      this.logger.warn(
        `Ingestion ${ingestionId}: ${unresolvedClients.length} store(s) did not resolve: ${unresolvedClients.join(', ')}`,
      )
    }

    return located.headerRowNumber
  }

  /**
   * Reads just the header row and checks the columns the declared type needs.
   *
   * Chunking into a throwaway queue name would be wasteful, so the headers are
   * read directly here — the point is to fail before any row job exists.
   */
  private async assertHeadersMatchType(
    filePath: string,
    fileType: Exclude<IngestionFileType, 'supply'>,
  ): Promise<void> {
    const headers = await this.readHeaderRow(filePath)

    // Raw ExcelJS headers — smartChunk has not slugified anything yet, so the
    // raw-text matcher is the correct one here, not the slugified one.
    const missing = REQUIRED_COLUMNS[fileType].filter(column => !hasRawColumn(headers, column))

    if (missing.length > 0) {
      throw new Error(
        `This does not look like a ${fileType} report: missing column(s) ${missing.join(', ')}. ` +
          `Expected something matching: ${REQUIRED_HEADERS[fileType].join(', ')}. Found: ${headers.join(', ')}`,
      )
    }
  }

  /**
   * True when a `sales` upload's header row carries the `clientStore`
   * (`Cliente`) column — the new, network-wide per-transaction format,
   * present since Aug 2026. The old, pre-aggregated per-SKU export never
   * carried store identity of its own (design D2 still holds for it: the
   * store comes from the upload, not the file).
   */
  private async isNetworkSalesFile(filePath: string): Promise<boolean> {
    const headers = await this.readHeaderRow(filePath)
    return hasRawColumn(headers, 'clientStore')
  }

  /** Reads row 1 of the first sheet as raw ExcelJS header text. */
  private async readHeaderRow(filePath: string): Promise<string[]> {
    const sheets = await readWorkbookRows(filePath)
    const sheet = sheets[0]
    if (!sheet) throw new Error('The uploaded workbook has no worksheets')

    return (sheet.rows[0] ?? [])
      .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
      .map(value => String(value))
  }
}

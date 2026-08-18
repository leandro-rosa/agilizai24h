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
import { hasColumn, type ColumnKey } from '../utils/row-mapping'

interface ParseFileJob {
  ingestionId: string
  correlationId?: string
}

/** Which columns each file type cannot be read without. */
const REQUIRED_COLUMNS: Record<IngestionFileType, ColumnKey[]> = {
  sales: ['product', 'quantity'],
  supply: ['product', 'restocked'],
  cost: ['product', 'cost'],
}

/**
 * Downloads an uploaded workbook and hands it to sheeter for chunking.
 *
 * Validates the declared type against the workbook's headers BEFORE chunking,
 * so a structural mismatch fails once rather than producing thousands of
 * failing row jobs.
 */
@HoldItProcessor(INTERNAL_QUEUES.PARSE_FILE)
export class ParseFileWorker extends HoldItWorkerHost<ParseFileJob> {
  constructor(
    private readonly ingestions: IngestionService,
    private readonly prisma: PrismaClientService,
    private readonly s3: S3Service,
    private readonly sheeter: SheeterProcessorService,
  ) {
    super()
  }

  async process(job: Job<ParseFileJob>): Promise<unknown> {
    const { ingestionId, correlationId } = job.data
    const ingestion = await this.prisma.ingestion.findUniqueOrThrow({ where: { id: ingestionId } })

    let workDir: string | undefined

    try {
      // The file is the evidence: it stays in object storage untouched, and a
      // copy is written to a temp path only because sheeter reads paths.
      const { body } = await this.s3.getFile(ingestion.object_key)

      workDir = await mkdtemp(join(tmpdir(), 'agiliz-ingestion-'))
      const filePath = join(workDir, ingestion.original_name.replace(/[^\w.-]/g, '_'))
      await writeFile(filePath, body)

      await this.assertHeadersMatchType(filePath, ingestion.file_type as IngestionFileType)

      const { jobs } = await this.sheeter.smartChunk({
        filePath,
        requestId: ingestionId,
        queueCallbackName: INTERNAL_QUEUES.STAGED_ROWS,
        additionalData: { ingestionId, fileType: ingestion.file_type, correlationId },
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

  /**
   * Reads just the header row and checks the columns the declared type needs.
   *
   * Uses sheeter's own reader by chunking into a throwaway queue name would be
   * wasteful, so the headers are read directly here — the point is to fail
   * before any row job exists.
   */
  private async assertHeadersMatchType(filePath: string, fileType: IngestionFileType): Promise<void> {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(filePath)

    const sheet = workbook.worksheets[0]
    if (!sheet) throw new Error('The uploaded workbook has no worksheets')

    const headers = (sheet.getRow(1).values as unknown[])
      .filter(value => value !== undefined && value !== null)
      .map(value => String(value))

    const missing = REQUIRED_COLUMNS[fileType].filter(column => !hasColumn(headers, column))

    if (missing.length > 0) {
      throw new Error(
        `This does not look like a ${fileType} report: missing column(s) ${missing.join(', ')}. ` +
          `Expected something matching: ${REQUIRED_HEADERS[fileType].join(', ')}. Found: ${headers.join(', ')}`,
      )
    }
  }
}

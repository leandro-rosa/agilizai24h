import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { S3Service } from '@app/aws'
import { HoldItBullMQBroker } from '@app/hold-it'
import { TREASURY_QUEUES, type TreasuryRawRowsJob } from '@app/treasury-ingestion-contracts'
import type { DriveClient } from '../../drive-source/services/drive-client'
import { XLSX_MIME } from '../../drive-source/constants/drive.constants'
import { parseItauStatementSheet } from '../parsers/itau-statement-sheet.parser'
import { parseC6StatementSheet } from '../parsers/c6-statement-sheet.parser'
import { parseC6InvoiceSheet } from '../parsers/c6-invoice-sheet.parser'
import { parsePagBankStatementSheet } from '../parsers/pagbank-statement-sheet.parser'
import { readAndClassifyTreasuryDriveFile } from '../utils/read-treasury-drive-file'
import { TREASURY_DRIVE_MAX_FILE_BYTES } from '../constants/treasury-drive.constants'
import { parseNubankStatement } from '../../treasury-ingestion/parsers/nubank.parser'
import { parseC6Invoice } from '../../treasury-ingestion/parsers/c6-invoice.parser'
import { TreasuryDriveProducer } from './treasury-drive.producer'
import { TreasuryDriveRepository } from './treasury-drive.repository'

/** Sheet-formatted sources — read via `readWorkbookRows`, parsed by row/column name. */
const SHEET_PARSERS = {
  itau_statement: parseItauStatementSheet,
  c6_statement: parseC6StatementSheet,
  c6_invoice: parseC6InvoiceSheet,
  pagbank_statement: parsePagBankStatementSheet,
} as const

/** PDF-formatted sources — read via `extractPdfPages`, parsed by line/text pattern. `c6_invoice`
 * is the one source reachable through EITHER map (a native Sheet one month, a password-protected
 * PDF the next — both real, confirmed against the real September file). */
const PDF_PARSERS = {
  nubank_statement: parseNubankStatement,
  c6_invoice: parseC6Invoice,
} as const

const refusal = (code: string, message: string) => ({ code, message })

/**
 * Imports a confirmed treasury Drive file. Two halves, deliberately apart — the same split
 * `DriveImportService` (the sibling sales/abastecimento Drive source) already uses for exactly
 * this reason (see that file's own doc comment, "Two halves, deliberately apart"):
 *
 * `requestImport` runs on the HTTP path and only claims and queues — no download, no parsing —
 * so it returns at once. The atomic claim (`repository.claimForImporting`) is what an operator's
 * double-click, or a re-click on a file already `imported`/`importing`, hits immediately as a 409
 * — never silently refused later inside the queue, where nobody observes it.
 *
 * `runImport` runs on the queue (`TreasuryDriveImportWorker`) and does the real work:
 * re-downloads and re-detects the source fresh — never trusts the scan's cached read for the
 * actual write, same "the job recomputes every check on the bytes it actually downloaded"
 * principle `DriveImportService.runImport` already follows. It does NOT re-claim: the request
 * path already did that, so it only checks the file is still `importing` — a stale or duplicate
 * job (e.g. a BullMQ redelivery after the worker process died mid-import) finds the file still
 * `importing` and simply proceeds, retrying the download from scratch, rather than failing the
 * atomic claim forever the way re-claiming would. Uploads the raw file to S3 (the evidence, kept
 * even after parsing — same convention as `TreasuryRawRowsJob.objectKey`'s own doc comment) and
 * publishes exactly one job to the existing `treasury.raw-rows` queue, unchanged.
 */
@Injectable()
export class TreasuryDriveImportService {
  private readonly logger = new Logger(TreasuryDriveImportService.name)

  constructor(
    private readonly repository: TreasuryDriveRepository,
    private readonly producer: TreasuryDriveProducer,
    private readonly broker: HoldItBullMQBroker,
    private readonly s3: S3Service,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // The request: claim, queue. Nothing is downloaded here.
  // ---------------------------------------------------------------------------------------------

  async requestImport(id: string, accountId: number, period: string, correlationId?: string): Promise<{ id: string; status: 'importing' }> {
    const file = await this.repository.findById(id)
    if (!file) throw new NotFoundException(refusal('not_found', 'No such treasury Drive file'))

    // The atomic step: of two simultaneous requests — or a double-click, or a re-click on a file
    // already `imported`/`importing` — exactly one moves the file to `importing` and the other
    // sees it already gone, refused here at once, never inside the queue where nobody observes it.
    const claimed = await this.repository.claimForImporting(id)
    if (!claimed) throw new ConflictException(refusal('already_imported', 'This file is already being imported or is no longer importable'))

    try {
      await this.producer.enqueueImport({ fileId: id, accountId, period }, correlationId)
    } catch (error) {
      // The claim already moved the file to `importing`; if it never actually got queued, it
      // must not stay stuck there forever — `error` is claimable again, so a retry can proceed.
      await this.repository.markError(id, 'The import could not be queued')
      this.logger.error(`Could not queue the import of treasury Drive file ${id}: ${(error as Error).message}`)
      throw new HttpException(refusal('queue_unavailable', 'The import could not be queued; try again'), 503)
    }

    return { id, status: 'importing' }
  }

  // ---------------------------------------------------------------------------------------------
  // The job: download, recompute every check, and only then write.
  // ---------------------------------------------------------------------------------------------

  async runImport(id: string, client: DriveClient, accountId: number, period: string, pdfPassword: string | undefined): Promise<{ status: 'imported'; jobId: string } | undefined> {
    const file = await this.repository.findById(id)
    // A stale or repeated job: the request path already claimed this file: if it is no longer
    // `importing`, someone else finished it (or reset it) and there is nothing left to do here.
    if (!file || file.status !== 'importing') return undefined

    try {
      const tmp = mkdtempSync(join(tmpdir(), 'treasury-drive-import-'))
      const destPath = join(tmp, file.drive_file_id)

      try {
        const result = await readAndClassifyTreasuryDriveFile(client, file.drive_file_id, file.mime_type, file.bank_folder_name, destPath, TREASURY_DRIVE_MAX_FILE_BYTES, pdfPassword)

        if (!result.detectedSource) {
          await this.repository.markError(id, 'Re-check at import time found no recognizable signature')
          throw new BadRequestException({ code: 'unrecognized' })
        }

        const detectedSource = result.detectedSource
        const { rows, rejections } = result.sheets
          ? SHEET_PARSERS[detectedSource as keyof typeof SHEET_PARSERS](result.sheets[0].rows)
          : PDF_PARSERS[detectedSource as keyof typeof PDF_PARSERS](result.pages!, period)

        // Only now does anything leave this process — same discipline as drive-import.service.ts's
        // own "nothing is written before the checks pass" comment. The original name always gets an
        // .xlsx extension when the Drive item reports none of its own (a sheet-formatted source); a
        // PDF-formatted source keeps whatever name/extension the Drive item already has.
        const bytes = await readFile(destPath)
        const originalName = extname(file.name) === '' ? `${file.name}.xlsx` : file.name
        const objectKey = `treasury-imports/${period}/${detectedSource}/${randomUUID()}-${originalName.replace(/[\\/]/g, '_')}`
        const contentType = result.sheets ? XLSX_MIME : 'application/pdf'
        await this.s3.uploadFile(objectKey, bytes, contentType)

        const job: TreasuryRawRowsJob = {
          schemaVersion: 1,
          source: detectedSource,
          accountId,
          period,
          objectKey,
          rows,
          rejections,
        }

        const published = await this.broker.holdIt({ queueName: TREASURY_QUEUES.RAW_ROWS, message: job, options: { attempts: 1 } })
        await this.repository.markImported(id, accountId)

        return { status: 'imported' as const, jobId: String(published.id ?? '') }
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    } catch (error) {
      if (!(error instanceof BadRequestException)) {
        await this.repository.markError(id, (error as Error).message)
      }
      throw error
    }
  }
}

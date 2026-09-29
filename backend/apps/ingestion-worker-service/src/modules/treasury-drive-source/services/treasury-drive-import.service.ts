import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { S3Service } from '@app/aws'
import { HoldItBullMQBroker } from '@app/hold-it'
import { TREASURY_QUEUES, type TreasuryRawRowsJob } from '@app/treasury-ingestion-contracts'
import type { DriveClient } from '../../drive-source/services/drive-client'
import { XLSX_MIME } from '../../drive-source/constants/drive.constants'
import { readWorkbookRows } from '../../ingestion/utils/read-workbook-rows'
import { TREASURY_DRIVE_MAX_FILE_BYTES } from '../constants/treasury-drive.constants'
import { detectTreasurySheetSource } from '../utils/detect-source'
import { parseItauStatementSheet } from '../parsers/itau-statement-sheet.parser'
import { parseC6StatementSheet } from '../parsers/c6-statement-sheet.parser'
import { parseC6InvoiceSheet } from '../parsers/c6-invoice-sheet.parser'
import { TreasuryDriveRepository } from './treasury-drive.repository'

/** Only the 3 sources this Drive source can ever detect (see detect-source.ts) — the other 4 arrive as PDF/CSV uploads through the gateway's own `/treasury-imports` path. */
const PARSERS = {
  itau_statement: parseItauStatementSheet,
  c6_statement: parseC6StatementSheet,
  c6_invoice: parseC6InvoiceSheet,
} as const

/**
 * Imports a confirmed treasury Drive file: re-downloads and re-detects fresh — never trusts
 * the scan's cached read for the actual write, same "the job recomputes every check on the
 * bytes it actually downloaded" principle drive-source's own `DriveImportService.runImport`
 * already follows for sales/supply. Uploads the raw file to S3 (the evidence, kept even after
 * parsing — same convention as `TreasuryRawRowsJob.objectKey`'s own doc comment) and publishes
 * exactly one job to the existing `treasury.raw-rows` queue, unchanged.
 */
@Injectable()
export class TreasuryDriveImportService {
  constructor(
    private readonly repository: TreasuryDriveRepository,
    private readonly broker: HoldItBullMQBroker,
    private readonly s3: S3Service,
  ) {}

  async import(id: string, client: DriveClient, accountId: number, period: string): Promise<{ status: 'imported'; jobId: string }> {
    const file = await this.repository.findById(id)
    if (!file) throw new BadRequestException({ code: 'not_found' })
    if (file.status === 'imported') throw new ConflictException({ code: 'already_imported' })

    await this.repository.markImporting(id)

    try {
      const tmp = mkdtempSync(join(tmpdir(), 'treasury-drive-import-'))
      const destPath = join(tmp, file.drive_file_id)

      try {
        await client.exportSheet(file.drive_file_id, destPath, TREASURY_DRIVE_MAX_FILE_BYTES)
        const sheets = await readWorkbookRows(destPath)
        const detectedSource = detectTreasurySheetSource(sheets, file.bank_folder_name)

        if (!detectedSource) {
          await this.repository.markError(id, 'Re-check at import time found no recognizable signature')
          throw new BadRequestException({ code: 'unrecognized' })
        }

        const parse = PARSERS[detectedSource as keyof typeof PARSERS]
        const { rows, rejections } = parse(sheets[0].rows)

        // Only now does anything leave this process — same discipline as drive-import.service.ts's
        // own "nothing is written before the checks pass" comment. `exportSheet` always produces
        // real xlsx bytes regardless of the source's original mime type (the treasury Drive scan
        // already established this: it calls exportSheet unconditionally, never download), so the
        // uploaded content type is always XLSX_MIME, and the original name always gets an .xlsx
        // extension when the Drive item (a native Sheet) reports none of its own.
        const bytes = await readFile(destPath)
        const originalName = extname(file.name) === '' ? `${file.name}.xlsx` : file.name
        const objectKey = `treasury-imports/${period}/${detectedSource}/${randomUUID()}-${originalName.replace(/[\\/]/g, '_')}`
        await this.s3.uploadFile(objectKey, bytes, XLSX_MIME)

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
      if (!(error instanceof BadRequestException) && !(error instanceof ConflictException)) {
        await this.repository.markError(id, (error as Error).message)
      }
      throw error
    }
  }
}

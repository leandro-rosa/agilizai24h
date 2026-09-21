import { extname } from 'node:path'
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { Prisma } from '../../../../generated/prisma/client'
import { readWorkbookRows } from '../../ingestion/utils/read-workbook-rows'
import { DRIVE_CONFIG, type DriveConfig } from '../config/drive.config'
import { GOOGLE_SHEET_MIME, type DriveImportableFileType } from '../constants/drive.constants'
import type { ContentSummary, Finding, StoredValidation, ValidationReport } from '../types/validation.types'
import { blockedWithoutContent, checkSize, evaluateValidation, typeFromFormat } from '../utils/evaluate-validation'
import { todayInSaoPaulo } from '../utils/sao-paulo-date'
import { summarizeWorkbook } from '../utils/summarize-workbook'
import { createTempWorkspace, sweepTempWorkspaces } from '../utils/temp-files'
import { DRIVE_CLIENT, DriveFileTooLargeError, type DriveClient } from './drive-client'
import { DriveRepository } from './drive.repository'

type DriveFileRow = NonNullable<Awaited<ReturnType<DriveRepository['findById']>>>

/** What a person may change before importing: the type and period the file is checked against. */
export interface ValidationOverride {
  fileType?: DriveImportableFileType
  period?: string
}

/**
 * Validates a Drive file WITHOUT importing it: reads it into a private temporary
 * path, reduces it to aggregates, evaluates the checks, stores only the aggregated
 * report, and deletes the file. It writes nothing to object storage and creates no
 * ingestion, and it never keeps a row, a card digit or a buyer number.
 *
 * Nothing is downloaded when the answer is already known: a synthetic file is never
 * read at all, a file the Drive reports as too large is refused on its metadata, and
 * a file whose content has not changed is re-evaluated from the stored aggregates
 * (which is how a change of period or type gets its answer at once).
 */
@Injectable()
export class DriveValidationService implements OnModuleInit {
  private readonly logger = new Logger(DriveValidationService.name)

  /** Replaceable in a test, to fix what "today" is for a month still in progress. */
  clock: () => Date = () => new Date()

  constructor(
    @Inject(DRIVE_CONFIG) private readonly config: DriveConfig,
    @Inject(DRIVE_CLIENT) private readonly drive: DriveClient,
    private readonly repository: DriveRepository,
  ) {}

  /** Removes anything a process that died mid-download left on disk. */
  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) return

    try {
      const removed = await sweepTempWorkspaces()
      if (removed > 0) this.logger.warn(`Removed ${removed} abandoned Drive workspace(s) from an earlier run`)
    } catch (error) {
      this.logger.warn(`Could not sweep abandoned Drive workspaces: ${(error as Error).message}`)
    }
  }

  /**
   * Re-evaluates a file against a (possibly new) type and period from the aggregates
   * already stored, WITHOUT downloading anything — so it is safe on the request path.
   * Null when the file was never validated or has changed since.
   */
  async reevaluate(fileId: string, override: ValidationOverride): Promise<ValidationReport | null> {
    const row = await this.repository.findById(fileId)
    if (!row) return null

    const stored = row.validation_report as unknown as StoredValidation | null
    if (!stored?.content || row.validated_fingerprint !== row.fingerprint || !row.content_sha256) return null

    return this.evaluateAndSave(
      row,
      stored.content,
      stored.report.sizeBytes,
      row.content_sha256,
      override.fileType ?? (row.suggested_file_type as DriveImportableFileType | null),
      override.period ?? row.suggested_period,
    )
  }

  async validate(fileId: string, override: ValidationOverride = {}): Promise<ValidationReport | null> {
    const row = await this.repository.findById(fileId)
    if (!row || row.status === 'importing' || row.status === 'missing') return null

    const fileType = override.fileType ?? (row.suggested_file_type as DriveImportableFileType | null)
    const period = override.period ?? row.suggested_period
    const sizeHint = row.size_bytes ?? 0

    // A synthetic file is never read: it is marked, shown and refused without a byte leaving the Drive.
    if (row.is_synthetic) {
      return this.saveBlocked(row, {
        code: 'synthetic',
        message: 'The file is marked as synthetic and can never be imported into real data',
      }, fileType, period, sizeHint)
    }

    // The Drive already says it is over the limit: refuse on the metadata, download nothing.
    const oversized = checkSize(sizeHint, this.config.maxFileBytes)
    if (oversized) return this.saveBlocked(row, oversized, fileType, period, sizeHint)

    // Unchanged content already summarised: re-evaluate for the (possibly new) type and period without downloading.
    const stored = row.validation_report as unknown as StoredValidation | null
    if (stored?.content && row.validated_fingerprint === row.fingerprint && row.content_sha256) {
      return this.evaluateAndSave(row, stored.content, stored.report.sizeBytes, row.content_sha256, fileType, period)
    }

    await this.repository.update(row.id, { validation_status: 'validating', error: null })

    const workspace = await createTempWorkspace()

    try {
      const destination = workspace.filePath(`file${extname(row.name) || '.xlsx'}`)
      const { sha256, bytes } =
        row.mime_type === GOOGLE_SHEET_MIME
          ? await this.drive.exportSheet(row.drive_file_id, destination, this.config.maxFileBytes)
          : await this.drive.download(row.drive_file_id, destination, this.config.maxFileBytes)

      // Opened and saved again, but not edited (a Sheet's version changes on a touch): still what was imported.
      if (row.status === 'changed' && row.imported_sha256 === sha256) {
        await this.repository.update(row.id, {
          status: 'imported',
          imported_fingerprint: row.fingerprint,
          validation_status: 'none',
          validation_report: Prisma.DbNull,
          validated_fingerprint: null,
          content_sha256: null,
          duplicate_of_id: null,
          error: null,
        })
        this.logger.log(`Drive file ${row.id} changed in the Drive but not in content: it is still the version that was imported`)
        return null
      }

      let summary: ContentSummary
      try {
        summary = summarizeWorkbook(await readWorkbookRows(destination))
      } catch {
        return this.saveBlocked(
          row,
          { code: 'unreadable_file', message: 'The file could not be read as a spreadsheet' },
          fileType,
          period,
          bytes,
          sha256,
        )
      }

      return await this.evaluateAndSave(row, summary, bytes, sha256, fileType, period)
    } catch (error) {
      if (error instanceof DriveFileTooLargeError) {
        return this.saveBlocked(
          row,
          {
            code: 'too_large',
            message: `The file is larger than the ${this.config.maxFileBytes}-byte limit`,
            details: { maxBytes: this.config.maxFileBytes },
          },
          fileType,
          period,
          sizeHint,
        )
      }

      // A Drive or network failure: nothing is known about the file, so nothing is decided.
      const message = (error as Error).message
      await this.repository.update(row.id, { validation_status: 'failed', error: message })
      this.logger.error(`Validation of Drive file ${row.id} failed: ${message}`)
      return null
    } finally {
      await workspace.cleanup()
    }
  }

  private async evaluateAndSave(
    row: DriveFileRow,
    summary: ContentSummary,
    sizeBytes: number,
    sha256: string,
    fileType: DriveImportableFileType | null,
    period: string | null,
  ): Promise<ValidationReport> {
    const input = {
      summary,
      fileType,
      period,
      sizeBytes,
      contentSha256: sha256,
      today: todayInSaoPaulo(this.clock()),
      thresholds: this.config.thresholds,
      maxFileBytes: this.config.maxFileBytes,
      isSynthetic: row.is_synthetic,
    }

    let report = evaluateValidation(input)
    let duplicateId: string | null = null

    // The duplicate check needs the type and period the evaluation settled on, so it runs second.
    if (report.fileType !== null && report.period !== null) {
      const earlier = await this.repository.findImportedByContent(sha256, report.fileType, report.period, row.id)

      if (earlier) {
        duplicateId = earlier.id
        report = evaluateValidation({
          ...input,
          duplicateOf: { id: earlier.id, path: `${earlier.path}/${earlier.name}`, importedAt: earlier.confirmed_at?.toISOString() ?? null },
        })
      }
    }

    await this.save(row, report, summary, sha256, duplicateId)
    return report
  }

  private async saveBlocked(
    row: DriveFileRow,
    finding: Finding,
    fileType: DriveImportableFileType | null,
    period: string | null,
    sizeBytes: number,
    sha256 = '',
  ): Promise<ValidationReport> {
    const report = blockedWithoutContent({ finding, fileType, period, sizeBytes, thresholds: this.config.thresholds })
    report.contentSha256 = sha256

    await this.save(row, report, { format: 'unknown', rowCount: 0, monthHistogram: {}, undatedRows: 0, storeDays: {} }, sha256 || null, null)
    return report
  }

  private async save(
    row: DriveFileRow,
    report: ValidationReport,
    content: ContentSummary,
    sha256: string | null,
    duplicateOfId: string | null,
  ): Promise<void> {
    const structureType = typeFromFormat(report.format)

    // The names only ever proposed a type and a period. What is inside the file refines
    // an empty proposal, and for the TYPE the structure of the file always wins over its name.
    const typeFromContent = structureType !== null && structureType !== row.suggested_file_type
    const periodFromContent = row.suggested_period === null && report.period !== null && report.blocking.every(f => f.code !== 'no_readable_dates')

    await this.repository.update(row.id, {
      validation_status: report.outcome,
      validation_report: JSON.parse(JSON.stringify({ report, content } satisfies StoredValidation)) as Prisma.InputJsonValue,
      validated_fingerprint: row.fingerprint,
      validated_at: new Date(),
      content_sha256: sha256,
      duplicate_of_id: duplicateOfId,
      error: null,
      ...(typeFromContent ? { suggested_file_type: structureType } : {}),
      ...(periodFromContent ? { suggested_period: report.period } : {}),
      ...(typeFromContent || periodFromContent ? { suggestion_note: 'derived_from_content' } : {}),
    })
  }
}

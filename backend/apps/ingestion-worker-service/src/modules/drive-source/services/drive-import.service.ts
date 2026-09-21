import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { S3Service } from '@app/aws'
import { isValidPeriod } from '@app/ingestion-contracts'
import { Prisma } from '../../../../generated/prisma/client'
import { IngestionService } from '../../ingestion/services/ingestion.service'
import { readWorkbookRows } from '../../ingestion/utils/read-workbook-rows'
import { DRIVE_CONFIG, type DriveConfig } from '../config/drive.config'
import {
  DRIVE_IMPORTABLE_FILE_TYPES,
  GOOGLE_SHEET_MIME,
  XLSX_MIME,
  type DriveFileStatus,
  type DriveImportableFileType,
} from '../constants/drive.constants'
import type { ImportDriveFileRequest, ImportDriveFileResponse } from '../types/drive-file.types'
import type { ContentSummary, StoredValidation, ValidationReport } from '../types/validation.types'
import { evaluateValidation } from '../utils/evaluate-validation'
import { todayInSaoPaulo } from '../utils/sao-paulo-date'
import { summarizeWorkbook } from '../utils/summarize-workbook'
import { createTempWorkspace } from '../utils/temp-files'
import { DRIVE_CLIENT, DriveFileTooLargeError, type DriveClient } from './drive-client'
import { DriveProducer } from './drive.producer'
import { DriveRepository } from './drive.repository'
import { DriveValidationService } from './drive-validation.service'

type DriveFileRow = NonNullable<Awaited<ReturnType<DriveRepository['findById']>>>

/** States a person may import from. `imported` joins them only to retry an import whose ingestion failed. */
const IMPORTABLE: readonly DriveFileStatus[] = ['new', 'changed', 'error']

/** Body of every refusal, so the admin can react to a `code` instead of parsing a message. */
const refusal = (code: string, message: string, extra: Record<string, unknown> = {}) => ({ code, message, ...extra })

const describeBlocking = (report: ValidationReport): string => report.blocking.map(finding => finding.message).join('; ')

/**
 * Imports a confirmed Drive file through the existing ingestion pipeline: the raw
 * file goes to object storage exactly like a manual upload, an ingestion is created,
 * and parsing, rejections, idempotent replace and status are all the existing ones.
 *
 * Two halves, deliberately apart. `requestImport` runs on the HTTP path and only
 * decides and records — no download, no parsing — so it returns at once. `runImport`
 * runs on the queue and does the work, recomputing every check on the bytes it
 * actually downloaded: what a person confirmed is a decision about a file they saw,
 * and this is where it is compared with the file that is really there.
 */
@Injectable()
export class DriveImportService {
  private readonly logger = new Logger(DriveImportService.name)

  /** Replaceable in a test, to fix what "today" is for a month still in progress. */
  clock: () => Date = () => new Date()

  constructor(
    @Inject(DRIVE_CONFIG) private readonly config: DriveConfig,
    @Inject(DRIVE_CLIENT) private readonly drive: DriveClient,
    private readonly repository: DriveRepository,
    private readonly validation: DriveValidationService,
    private readonly producer: DriveProducer,
    private readonly s3: S3Service,
    private readonly ingestions: IngestionService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // The request: decide, record, queue. Nothing is downloaded here.
  // ---------------------------------------------------------------------------------------------

  async requestImport(id: string, request: ImportDriveFileRequest, correlationId?: string): Promise<ImportDriveFileResponse> {
    if (!(DRIVE_IMPORTABLE_FILE_TYPES as readonly string[]).includes(request.file_type)) {
      throw new BadRequestException(refusal('invalid_file_type', `file_type must be one of: ${DRIVE_IMPORTABLE_FILE_TYPES.join(', ')}`))
    }
    if (!isValidPeriod(request.period)) {
      throw new BadRequestException(refusal('invalid_period', 'period must be YYYY-MM'))
    }

    const row = await this.repository.findById(id)
    if (!row) throw new NotFoundException(refusal('not_found', 'No such Drive file'))

    if (row.is_synthetic) {
      throw new UnprocessableEntityException(refusal('synthetic_file', 'A synthetic file can never be imported into real data'))
    }

    const from = await this.importableFrom(row)
    if (!from.includes(row.status as DriveFileStatus)) {
      throw new ConflictException(refusal('not_importable', `A file that is ${row.status} cannot be imported now`))
    }

    // What the stored aggregates say about THIS type and period, without downloading anything.
    // Null when the file was never validated: the job runs every check on the real bytes anyway.
    const report = await this.validation.reevaluate(id, { fileType: request.file_type, period: request.period })

    if (report?.outcome === 'blocked') {
      throw new UnprocessableEntityException(refusal('blocked', describeBlocking(report), { blocking: report.blocking }))
    }

    if (report?.outcome === 'needs_validation' && request.confirm_validation?.content_sha256 !== report.contentSha256) {
      throw new UnprocessableEntityException(
        refusal('validation_confirmation_required', 'The inconsistencies of this file must be reviewed and confirmed before it is imported', {
          inconsistencies: report.inconsistencies,
          content_sha256: report.contentSha256,
        }),
      )
    }

    const replaced = await this.repository.findReplaceableIngestion(request.file_type, request.period)
    if (replaced && request.confirm_replace !== true) {
      throw new ConflictException(
        refusal('replace_confirmation_required', 'Importing this file replaces data already ingested for this type and period', {
          would_replace: { ingestion_id: replaced.id, ingested_at: replaced.uploaded_at.toISOString(), status: replaced.status },
        }),
      )
    }

    // The atomic step: of two simultaneous requests, exactly one moves the file to `importing`.
    const claimed = await this.repository.claimForImport(id, from, {
      confirmedBy: request.confirmed_by ?? null,
      fileType: request.file_type,
      period: request.period,
      validationConfirmedSha256: report?.outcome === 'needs_validation' ? request.confirm_validation?.content_sha256 : undefined,
    })
    if (!claimed) throw new ConflictException(refusal('not_importable', 'This file is already being imported or is no longer importable'))

    try {
      await this.producer.enqueueImport({ fileId: id }, correlationId)
    } catch (error) {
      await this.repository.update(id, { status: 'error', error: 'The import could not be queued', import_file_type: null, import_period: null })
      this.logger.error(`Could not queue the import of Drive file ${id}: ${(error as Error).message}`)
      throw new HttpException(refusal('queue_unavailable', 'The import could not be queued; try again'), 503)
    }

    return { id, status: 'importing' }
  }

  /** `new`, `changed` and `error` — plus `imported` when the ingestion this file produced failed, which is what makes a retry possible. */
  private async importableFrom(row: DriveFileRow): Promise<readonly DriveFileStatus[]> {
    if (row.status === 'imported' && row.imported_ingestion_id) {
      const [ingestion] = await this.repository.findIngestions([row.imported_ingestion_id])
      if (ingestion?.status === 'failed') return [...IMPORTABLE, 'imported']
    }

    return IMPORTABLE
  }

  // ---------------------------------------------------------------------------------------------
  // The job: download, recompute every check, and only then write.
  // ---------------------------------------------------------------------------------------------

  async runImport(id: string, correlationId?: string): Promise<void> {
    const row = await this.repository.findById(id)
    // A stale or repeated job: nothing else has claimed this file, so there is nothing to do.
    if (!row || row.status !== 'importing') return

    const fileType = row.import_file_type as DriveImportableFileType | null
    const period = row.import_period
    if (!fileType || !period) {
      await this.fail(row, 'The import has no confirmed type and period', null)
      return
    }

    // Values an earlier, successful import recorded: put back if this one fails after taking the slot.
    const previous = {
      imported_sha256: row.imported_sha256,
      imported_file_type: row.imported_file_type,
      imported_period: row.imported_period,
    }
    let tookSlot = false

    const workspace = await createTempWorkspace()

    try {
      const destination = workspace.filePath(`file${extname(row.name) || '.xlsx'}`)
      const { sha256 } =
        row.mime_type === GOOGLE_SHEET_MIME
          ? await this.drive.exportSheet(row.drive_file_id, destination, this.config.maxFileBytes)
          : await this.drive.download(row.drive_file_id, destination, this.config.maxFileBytes)

      let summary: ContentSummary
      try {
        summary = summarizeWorkbook(await readWorkbookRows(destination))
      } catch {
        await this.fail(row, 'The file could not be read as a spreadsheet', null)
        return
      }

      // Every check, again, on the bytes actually downloaded.
      const earlier = await this.repository.findImportedByContent(sha256, fileType, period, row.id)
      const bytes = await readFile(destination)
      const report = evaluateValidation({
        summary,
        fileType,
        period,
        sizeBytes: bytes.length,
        contentSha256: sha256,
        today: todayInSaoPaulo(this.clock()),
        thresholds: this.config.thresholds,
        maxFileBytes: this.config.maxFileBytes,
        isSynthetic: row.is_synthetic,
        duplicateOf: earlier
          ? { id: earlier.id, path: `${earlier.path}/${earlier.name}`, importedAt: earlier.confirmed_at?.toISOString() ?? null }
          : null,
      })

      await this.saveValidation(row, report, summary, sha256, earlier?.id ?? null)

      if (report.outcome === 'blocked') {
        await this.fail(row, describeBlocking(report), null)
        return
      }

      // A confirmation is bound to the content that was reviewed: if the file changed since, it does not apply.
      if (report.outcome === 'needs_validation' && row.validation_confirmed_sha256 !== sha256) {
        await this.fail(row, 'The file changed since its inconsistencies were confirmed: review them again', null)
        return
      }

      // Take the slot for this content. The unique index makes this the atomic duplicate guard: if
      // another import of the same content raced to here, exactly one of the two gets past this line.
      try {
        await this.repository.update(row.id, { imported_sha256: sha256, imported_file_type: fileType, imported_period: period })
        tookSlot = true
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          await this.fail(row, 'The same content was imported for this type and period by another file', null)
          return
        }
        throw error
      }

      // Only now does anything leave this process: the same key scheme as a manual upload with no store.
      const ingestionId = randomUUID()
      const originalName = row.mime_type === GOOGLE_SHEET_MIME && extname(row.name) === '' ? `${row.name}.xlsx` : row.name
      const objectKey = `ingestions/${period}/network/${ingestionId}-${originalName.replace(/[\\/]/g, '_')}`

      await this.s3.uploadFile(objectKey, bytes, row.mime_type === GOOGLE_SHEET_MIME ? XLSX_MIME : row.mime_type)
      await this.ingestions.create({ id: ingestionId, fileType, objectKey, originalName, period, correlationId })

      await this.repository.update(row.id, {
        status: 'imported',
        imported_ingestion_id: ingestionId,
        imported_fingerprint: row.fingerprint,
        error: null,
        import_file_type: null,
        import_period: null,
      })

      this.logger.log(`Imported Drive file ${row.id} as ingestion ${ingestionId} (${fileType} ${period})`)
    } catch (error) {
      const message =
        error instanceof DriveFileTooLargeError ? `The file is larger than the ${this.config.maxFileBytes}-byte limit` : (error as Error).message

      await this.fail(row, message, tookSlot ? previous : null)
      this.logger.error(`Import of Drive file ${row.id} failed: ${message}`)
    } finally {
      await workspace.cleanup()
    }
  }

  /** Records why an import did not happen, and hands back the slot it may have taken. Nothing was written to storage or `Ingestion` by the paths that call this before the checks pass. */
  private async fail(
    row: DriveFileRow,
    message: string,
    restore: { imported_sha256: string | null; imported_file_type: string | null; imported_period: string | null } | null,
  ): Promise<void> {
    await this.repository.update(row.id, {
      status: 'error',
      error: message,
      import_file_type: null,
      import_period: null,
      ...(restore ?? {}),
    })
  }

  private async saveValidation(
    row: DriveFileRow,
    report: ValidationReport,
    content: ContentSummary,
    sha256: string,
    duplicateOfId: string | null,
  ): Promise<void> {
    await this.repository.update(row.id, {
      validation_status: report.outcome,
      validation_report: JSON.parse(JSON.stringify({ report, content } satisfies StoredValidation)) as Prisma.InputJsonValue,
      validated_fingerprint: row.fingerprint,
      validated_at: new Date(),
      content_sha256: sha256,
      duplicate_of_id: duplicateOfId,
    })
  }

  // ---------------------------------------------------------------------------------------------
  // Ignore / restore
  // ---------------------------------------------------------------------------------------------

  /**
   * Hides a file the operator does not want proposed, or brings it back. An ignored
   * file stays ignored until its content changes; restoring puts it back where it was
   * waiting (`changed` if an earlier version was imported, else `new`).
   */
  async setIgnored(id: string, ignored: boolean): Promise<{ id: string; status: DriveFileStatus }> {
    const row = await this.repository.findById(id)
    if (!row) throw new NotFoundException(refusal('not_found', 'No such Drive file'))

    if (ignored) {
      if (!(['new', 'changed', 'error'] as DriveFileStatus[]).includes(row.status as DriveFileStatus)) {
        throw new ConflictException(refusal('not_ignorable', `A file that is ${row.status} cannot be ignored`))
      }
      await this.repository.update(id, { status: 'ignored' })
      return { id, status: 'ignored' }
    }

    if (row.status !== 'ignored') {
      throw new ConflictException(refusal('not_ignored', 'This file is not ignored'))
    }
    const status: DriveFileStatus = row.imported_fingerprint ? 'changed' : 'new'
    await this.repository.update(id, { status })
    return { id, status }
  }
}

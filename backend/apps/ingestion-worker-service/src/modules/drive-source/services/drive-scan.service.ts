import { Inject, Injectable, Logger } from '@nestjs/common'
import { Prisma } from '../../../../generated/prisma/client'
import { DRIVE_CONFIG, type DriveConfig } from '../config/drive.config'
import { DRIVE_MAX_TRAVERSAL_DEPTH, type DriveFileStatus } from '../constants/drive.constants'
import { planScanUpdate, type ExistingDriveFile, type TrackedFile } from '../utils/scan-transitions'
import { suggest } from '../utils/suggestions'
import { isSupportedFile, isSynthetic, matchesIncludePatterns } from '../utils/tracking'
import { DRIVE_CLIENT, type DriveClient, type DriveItem } from './drive-client'
import { DriveProducer } from './drive.producer'
import { DriveRepository, type DriveScanTrigger } from './drive.repository'

export interface ScanSummary {
  runId: number
  outcome: 'ok' | 'failed'
  filesSeen: number
  skippedByPattern: number
  newCount: number
  changedCount: number
  missingCount: number
  error?: string
}

/** Everything a scan learned from the Drive, gathered BEFORE anything is written. */
interface Collected {
  tracked: TrackedFile[]
  skippedByPattern: number
}

const fingerprintOf = (item: DriveItem): string => item.md5Checksum ?? `${item.modifiedTime}#${item.version ?? ''}`

/** A file the scan may mark `missing` when it is no longer listed. Never one that is being imported. */
const MAY_GO_MISSING: readonly DriveFileStatus[] = ['new', 'changed', 'imported', 'ignored', 'error']

/**
 * Scans the configured Drive folder: reads metadata only — never any content —
 * and brings the tracked files up to date. It writes nothing until the whole
 * listing has been read, so a listing that fails halfway (the folder was
 * un-shared, the Drive is down) leaves every known file and status exactly as it
 * was. It never imports anything; at most it queues a validation.
 */
@Injectable()
export class DriveScanService {
  private readonly logger = new Logger(DriveScanService.name)

  constructor(
    @Inject(DRIVE_CONFIG) private readonly config: DriveConfig,
    @Inject(DRIVE_CLIENT) private readonly drive: DriveClient,
    private readonly repository: DriveRepository,
    private readonly producer: DriveProducer,
  ) {}

  /** Returns null when the source is not configured: a stale schedule firing after the variables were removed. */
  async scan(trigger: DriveScanTrigger): Promise<ScanSummary | null> {
    if (!this.config.enabled || !this.config.rootFolderId) return null

    const run = await this.repository.startScanRun(trigger)

    try {
      const collected = await this.collect(this.config.rootFolderId)
      const applied = await this.apply(collected)

      await this.repository.finishScanRun(run.id, {
        outcome: 'ok',
        filesSeen: collected.tracked.length + collected.skippedByPattern,
        skippedByPattern: collected.skippedByPattern,
        newCount: applied.newCount,
        changedCount: applied.changedCount,
      })
      await this.repository.pruneScanRuns()

      // Validation is queued only after everything is persisted, and it never imports.
      if (this.config.autoValidate) {
        for (const fileId of applied.toValidate) {
          await this.producer.enqueueValidation({ fileId })
        }
      }

      this.logger.log(
        `Drive scan ${run.id} (${trigger}): ${collected.tracked.length} tracked, ${collected.skippedByPattern} skipped by pattern, ` +
          `${applied.newCount} new, ${applied.changedCount} changed, ${applied.missingCount} missing`,
      )

      return {
        runId: run.id,
        outcome: 'ok',
        filesSeen: collected.tracked.length + collected.skippedByPattern,
        skippedByPattern: collected.skippedByPattern,
        newCount: applied.newCount,
        changedCount: applied.changedCount,
        missingCount: applied.missingCount,
      }
    } catch (error) {
      const message = (error as Error).message
      await this.repository.finishScanRun(run.id, {
        outcome: 'failed',
        filesSeen: 0,
        skippedByPattern: 0,
        newCount: 0,
        changedCount: 0,
        error: message,
      })
      this.logger.error(`Drive scan ${run.id} (${trigger}) failed: ${message}`)

      return { runId: run.id, outcome: 'failed', filesSeen: 0, skippedByPattern: 0, newCount: 0, changedCount: 0, missingCount: 0, error: message }
    }
  }

  /**
   * Breadth-first from the root, to a depth of three: root → month folder →
   * (a report folder) → file. A month folder is a direct child folder of the root.
   * Only metadata is listed.
   */
  private async collect(rootFolderId: string): Promise<Collected> {
    const tracked: TrackedFile[] = []
    let skippedByPattern = 0

    const consider = (item: DriveItem, folderSegments: string[]): void => {
      if (!isSupportedFile(item)) return

      const segmentsBelowMonthFolder = [...folderSegments.slice(1), item.name]
      if (!matchesIncludePatterns(segmentsBelowMonthFolder, this.config.includePatterns)) {
        skippedByPattern++
        return
      }

      tracked.push({
        driveFileId: item.id,
        name: item.name,
        path: folderSegments.join('/'),
        mimeType: item.mimeType,
        sizeBytes: item.size,
        fingerprint: fingerprintOf(item),
        isSynthetic: isSynthetic([...folderSegments, item.name], this.config.syntheticPattern),
        suggestion: suggest(folderSegments, item.name),
      })
    }

    const walk = async (folderId: string, folderSegments: string[]): Promise<void> => {
      for await (const item of this.drive.listFolder(folderId)) {
        if (!item.isFolder) {
          consider(item, folderSegments)
        } else if (folderSegments.length === 0 || folderSegments.length < DRIVE_MAX_TRAVERSAL_DEPTH - 1) {
          await walk(item.id, [...folderSegments, item.name])
        }
      }
    }

    await walk(rootFolderId, [])

    return { tracked, skippedByPattern }
  }

  private async apply(collected: Collected): Promise<{
    newCount: number
    changedCount: number
    missingCount: number
    toValidate: string[]
  }> {
    let newCount = 0
    let changedCount = 0
    const toValidate: string[] = []

    for (const file of collected.tracked) {
      const row = await this.repository.findByDriveFileId(file.driveFileId)
      const existing: ExistingDriveFile | null = row
        ? {
            status: row.status as DriveFileStatus,
            fingerprint: row.fingerprint,
            importedFingerprint: row.imported_fingerprint,
            validationStatus: row.validation_status as ExistingDriveFile['validationStatus'],
            validatedFingerprint: row.validated_fingerprint,
          }
        : null

      const plan = planScanUpdate(existing, file)
      const metadata = {
        name: file.name,
        path: file.path,
        mime_type: file.mimeType,
        size_bytes: file.sizeBytes,
        fingerprint: file.fingerprint,
        is_synthetic: file.isSynthetic,
        suggested_file_type: file.suggestion.fileType,
        suggested_period: file.suggestion.period,
        suggestion_note: file.suggestion.note,
      }

      let id: string

      if (row === null) {
        id = (await this.repository.create({ drive_file_id: file.driveFileId, status: plan.status, ...metadata })).id
      } else {
        id = row.id
        await this.repository.update(row.id, {
          ...metadata,
          status: plan.status,
          last_seen_at: new Date(),
          ...(plan.resetValidation ? RESET_VALIDATION : {}),
          // A status that leaves `error` or `ignored` clears the old reason.
          ...(plan.status !== row.status && row.status === 'error' ? { error: null } : {}),
        })
      }

      if (plan.counts === 'new') newCount++
      if (plan.counts === 'changed') changedCount++
      if (plan.validate) toValidate.push(id)
    }

    // A file no longer listed is marked missing — informational: nothing already ingested is touched.
    const seen = new Set(collected.tracked.map(file => file.driveFileId))
    let missingCount = 0

    for (const row of await this.repository.list()) {
      if (!seen.has(row.drive_file_id) && MAY_GO_MISSING.includes(row.status as DriveFileStatus)) {
        await this.repository.update(row.id, { status: 'missing' })
        missingCount++
      }
    }

    return { newCount, changedCount, missingCount, toValidate }
  }
}

/** What a content change invalidates: the last validation, its hash, the duplicate verdict and any review. */
const RESET_VALIDATION = {
  validation_status: 'none',
  validation_report: Prisma.DbNull,
  validated_fingerprint: null,
  validated_at: null,
  content_sha256: null,
  duplicate_of_id: null,
  validation_confirmed_by: null,
  validation_confirmed_at: null,
  validation_confirmed_sha256: null,
  error: null,
}

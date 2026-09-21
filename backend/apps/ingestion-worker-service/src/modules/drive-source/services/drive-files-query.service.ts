import { Inject, Injectable } from '@nestjs/common'
import { DRIVE_CONFIG, type DriveConfig } from '../config/drive.config'
import {
  DRIVE_FILE_STATUSES,
  type DriveFileStatus,
  type DriveImportableFileType,
  type DriveValidationStatus,
} from '../constants/drive.constants'
import type { DriveFileView, DriveStatusView } from '../types/drive-file.types'
import type { StoredValidation } from '../types/validation.types'
import { DriveRepository } from './drive.repository'

type Row = Awaited<ReturnType<DriveRepository['list']>>[number]

/** Statuses in which a file still waits for a decision, so what it would replace is worth showing. */
const WAITING: readonly DriveFileStatus[] = ['new', 'changed', 'error']

/**
 * Reads: builds what the admin shows. The one derived thing lives here — a file
 * that was imported but whose ingestion later FAILED is shown as `error`, with the
 * ingestion's message, so the scan does not have to watch ingestions and a person
 * can retry it. Nothing in this service writes.
 */
@Injectable()
export class DriveFilesQueryService {
  constructor(
    @Inject(DRIVE_CONFIG) private readonly config: DriveConfig,
    private readonly repository: DriveRepository,
  ) {}

  /** Parses `?status=new,changed`, ignoring anything that is not a status. */
  parseStatuses(raw?: string): DriveFileStatus[] | undefined {
    if (!raw) return undefined
    const wanted = raw.split(',').map(status => status.trim())
    const valid = wanted.filter((status): status is DriveFileStatus => (DRIVE_FILE_STATUSES as readonly string[]).includes(status))

    return valid.length > 0 ? valid : undefined
  }

  async list(statuses?: DriveFileStatus[]): Promise<DriveFileView[]> {
    const rows = await this.repository.list(statuses)

    const ingestions = new Map(
      (await this.repository.findIngestions(rows.flatMap(row => (row.imported_ingestion_id ? [row.imported_ingestion_id] : [])))).map(i => [i.id, i]),
    )
    const duplicates = new Map(
      (await this.repository.findByIds(rows.flatMap(row => (row.duplicate_of_id ? [row.duplicate_of_id] : [])))).map(d => [d.id, d]),
    )

    // One lookup per type and period, however many files share them.
    const replaceable = new Map<string, Awaited<ReturnType<DriveRepository['findReplaceableIngestion']>>>()
    const replaceOf = async (fileType: string, period: string) => {
      const key = `${fileType}:${period}`
      if (!replaceable.has(key)) replaceable.set(key, await this.repository.findReplaceableIngestion(fileType, period))
      return replaceable.get(key) ?? null
    }

    const views: DriveFileView[] = []

    for (const row of rows) {
      const stored = row.validation_report as unknown as StoredValidation | null
      const validation = stored?.report ?? null
      const ingestion = row.imported_ingestion_id ? ingestions.get(row.imported_ingestion_id) : undefined
      const ingestionFailed = row.status === 'imported' && ingestion?.status === 'failed'
      const status: DriveFileStatus = ingestionFailed ? 'error' : (row.status as DriveFileStatus)

      const fileType = validation?.fileType ?? row.suggested_file_type
      const period = validation?.period ?? row.suggested_period
      const waiting = WAITING.includes(status)
      const replaced = waiting && fileType && period ? await replaceOf(fileType, period) : null

      const duplicate = row.duplicate_of_id ? duplicates.get(row.duplicate_of_id) : undefined

      views.push(this.toView(row, status, ingestionFailed ? (ingestion?.error ?? 'The ingestion failed') : row.error, validation, {
        duplicate,
        replaced,
      }))
    }

    return views
  }

  private toView(
    row: Row,
    status: DriveFileStatus,
    error: string | null,
    validation: StoredValidation['report'] | null,
    extra: {
      duplicate?: Row
      replaced: { id: string; status: string; uploaded_at: Date } | null
    },
  ): DriveFileView {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      status,
      error,
      is_synthetic: row.is_synthetic,
      suggested_file_type: row.suggested_file_type as DriveImportableFileType | null,
      suggested_period: row.suggested_period,
      suggestion_note: row.suggestion_note,
      validation_status: row.validation_status as DriveValidationStatus,
      validation,
      duplicate_of: extra.duplicate
        ? { id: extra.duplicate.id, path: `${extra.duplicate.path}/${extra.duplicate.name}`, imported_at: extra.duplicate.confirmed_at?.toISOString() ?? null }
        : null,
      would_replace: extra.replaced
        ? { ingestion_id: extra.replaced.id, ingested_at: extra.replaced.uploaded_at.toISOString(), status: extra.replaced.status }
        : null,
      imported_ingestion_id: row.imported_ingestion_id,
      confirmed_by: row.confirmed_by,
      confirmed_at: row.confirmed_at?.toISOString() ?? null,
      validation_confirmed_by: row.validation_confirmed_by,
      validation_confirmed_at: row.validation_confirmed_at?.toISOString() ?? null,
      last_seen_at: row.last_seen_at.toISOString(),
    }
  }

  /** The state of the source and of the last scan. Never any credential: only whether one is configured. */
  async status(): Promise<DriveStatusView> {
    const last = await this.repository.latestScanRun()

    return {
      configured: this.config.enabled,
      auto_validate: this.config.autoValidate,
      max_file_bytes: this.config.maxFileBytes,
      scan_cron: this.config.scanCron,
      thresholds: this.config.thresholds,
      last_scan: last
        ? {
            started_at: last.started_at.toISOString(),
            finished_at: last.finished_at?.toISOString() ?? null,
            trigger: last.trigger as 'schedule' | 'manual',
            outcome: last.outcome as 'ok' | 'failed' | 'running',
            files_seen: last.files_seen,
            skipped_by_pattern: last.skipped_by_pattern,
            new_count: last.new_count,
            changed_count: last.changed_count,
            error: last.error,
          }
        : null,
    }
  }
}

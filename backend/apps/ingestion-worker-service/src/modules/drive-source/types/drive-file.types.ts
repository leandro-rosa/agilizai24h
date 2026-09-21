import type {
  DriveFileStatus,
  DriveImportableFileType,
  DriveValidationStatus,
} from '../constants/drive.constants'
import type { ValidationReport, ValidationThresholds } from './validation.types'

/** One row of `GET /drive-files`: everything the admin needs to show a file and its next action. */
export interface DriveFileView {
  id: string
  name: string
  /** Folder path from the root, e.g. `agosto-26/Relatório_2026`. */
  path: string
  mime_type: string
  size_bytes: number | null
  status: DriveFileStatus
  error: string | null
  is_synthetic: boolean
  suggested_file_type: DriveImportableFileType | null
  suggested_period: string | null
  suggestion_note: string | null
  validation_status: DriveValidationStatus
  /** The aggregated result of validating the file; null until it has been validated. */
  validation: ValidationReport | null
  /** Set when the content is identical to a file already imported for the same type and period. */
  duplicate_of: { id: string; path: string; imported_at: string | null } | null
  /** Set when importing would replace data already ingested for the same type and period. */
  would_replace: { ingestion_id: string; ingested_at: string; status: string } | null
  imported_ingestion_id: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  validation_confirmed_by: string | null
  validation_confirmed_at: string | null
  last_seen_at: string
}

/** `GET /drive-files/status`: whether the source is on and how the last scan went. Never any credential. */
export interface DriveStatusView {
  configured: boolean
  auto_validate: boolean
  max_file_bytes: number
  scan_cron: string
  thresholds: ValidationThresholds
  last_scan: {
    started_at: string
    finished_at: string | null
    trigger: 'schedule' | 'manual'
    outcome: 'ok' | 'failed' | 'running'
    files_seen: number
    skipped_by_pattern: number
    new_count: number
    changed_count: number
    error: string | null
  } | null
}

/** Body of `POST /drive-files/:id/import`. */
export interface ImportDriveFileRequest {
  file_type: DriveImportableFileType
  /** `YYYY-MM`, as confirmed by the person. */
  period: string
  /** Required when the import would replace an already-ingested period. */
  confirm_replace?: boolean
  /** Required when validation found inconsistencies; bound to the content that was reviewed. */
  confirm_validation?: { content_sha256: string }
  /** The session identity, filled in by the gateway. */
  confirmed_by?: string
}

export interface ImportDriveFileResponse {
  id: string
  status: DriveFileStatus
}

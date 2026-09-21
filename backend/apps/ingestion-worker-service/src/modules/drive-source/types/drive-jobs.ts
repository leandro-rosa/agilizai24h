import type { DriveImportableFileType } from '../constants/drive.constants'

/**
 * Every Drive job carries the same versioned envelope, so a worker can refuse a
 * payload it does not understand instead of misreading it after a deploy.
 */
export interface DriveJobEnvelope<T> {
  schemaVersion: 1
  emittedAt: string
  correlationId?: string
  payload: T
}

export interface DriveScanPayload {
  trigger: 'schedule' | 'manual'
}

export interface DriveValidatePayload {
  /** Our `drive_file.id`, not the Drive's. */
  fileId: string
  /** Set when a person changed the type or period and the result must be re-evaluated. */
  fileType?: DriveImportableFileType
  period?: string
}

export interface DriveImportPayload {
  fileId: string
  correlationId?: string
}

export function driveEnvelope<T>(payload: T, correlationId?: string): DriveJobEnvelope<T> {
  return { schemaVersion: 1, emittedAt: new Date().toISOString(), correlationId, payload }
}

import type { DriveFileStatus, DriveValidationStatus } from '../constants/drive.constants'
import type { Suggestion } from './suggestions'

/** A file the scan found and decided to track, in the shape the scan persists. */
export interface TrackedFile {
  driveFileId: string
  name: string
  /** Folder path from the root, without the file name. */
  path: string
  mimeType: string
  sizeBytes: number | null
  /** md5Checksum when the Drive provides one, else "{modifiedTime}#{version}". */
  fingerprint: string
  isSynthetic: boolean
  suggestion: Suggestion
}

/** What the scan needs to know about a file it already tracks. */
export interface ExistingDriveFile {
  status: DriveFileStatus
  fingerprint: string
  importedFingerprint: string | null
  validationStatus: DriveValidationStatus
  validatedFingerprint: string | null
}

export interface ScanPlan {
  action: 'create' | 'update'
  status: DriveFileStatus
  /** The content changed, so the last validation (and any review of it) no longer applies. */
  resetValidation: boolean
  /** Queue a validation job for this file. */
  validate: boolean
  /** Which counter of the scan run this file adds to: it just became new, or just became changed. */
  counts: 'new' | 'changed' | null
}

/**
 * How a scan changes what is known about one file. Pure on purpose: the states
 * and their transitions are the contract of the feature (an unchanged imported
 * file is never proposed again, an edited one is proposed as a replacement, an
 * ignored one stays ignored until its content changes), so they are decided
 * here, where they can be tested without a database or a Drive.
 */
export function planScanUpdate(existing: ExistingDriveFile | null, file: TrackedFile): ScanPlan {
  if (existing === null) {
    return { action: 'create', status: 'new', resetValidation: false, validate: true, counts: 'new' }
  }

  const changed = existing.fingerprint !== file.fingerprint
  const wasImported = existing.importedFingerprint !== null
  /** Where a file with a different version than the last one seen goes: a replacement, or brand new. */
  const proposedAgain: DriveFileStatus = wasImported ? 'changed' : 'new'

  let status: DriveFileStatus = existing.status
  let resetValidation = false

  switch (existing.status) {
    case 'imported':
      status = file.fingerprint === existing.importedFingerprint ? 'imported' : 'changed'
      resetValidation = status === 'changed'
      break

    case 'missing':
      if (wasImported) {
        status = file.fingerprint === existing.importedFingerprint ? 'imported' : 'changed'
      } else {
        status = 'new'
      }
      resetValidation = changed && status !== 'imported'
      break

    case 'ignored':
      if (changed) {
        status = proposedAgain
        resetValidation = true
      }
      break

    case 'error':
      if (changed) {
        status = proposedAgain
        resetValidation = true
      }
      break

    case 'new':
    case 'changed':
      resetValidation = changed
      break

    case 'importing':
      // An import is under way: nothing a scan sees may change its course. The import
      // job recomputes the content hash itself before it writes anything.
      break
  }

  const waitingForDecision = status === 'new' || status === 'changed'
  const staleValidation = existing.validatedFingerprint !== null && existing.validatedFingerprint !== file.fingerprint
  const needsValidation =
    resetValidation || existing.validationStatus === 'none' || existing.validationStatus === 'failed' || staleValidation

  return {
    action: 'update',
    status,
    resetValidation,
    validate: waitingForDecision && needsValidation,
    counts: status !== existing.status && (status === 'new' || status === 'changed') ? status : null,
  }
}

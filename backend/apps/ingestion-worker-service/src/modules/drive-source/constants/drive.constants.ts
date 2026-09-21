/**
 * Internal queues of the Drive source. They never leave this service, so they
 * live here next to `INTERNAL_QUEUES` and not in `@app/ingestion-contracts`
 * (which is only for queues that cross services). Every one of them must also
 * be listed in `REGISTERED_QUEUES`, or publishing to it fails at runtime with
 * "Nest could not find BullQueue_<name>" — see registered-queues.spec.ts.
 */
export const DRIVE_QUEUES = {
  SCAN: 'ingestion.drive-scan',
  VALIDATE: 'ingestion.drive-validate',
  IMPORT: 'ingestion.drive-import',
} as const

/** Fixed id of the repeatable scan, so registering it twice never duplicates it. */
export const DRIVE_SCHEDULER_ID = 'drive-scan'

/** The scan runs at the operator's local time, whatever the server's clock says. */
export const DRIVE_TIME_ZONE = 'America/Sao_Paulo'

/** Read-only, on purpose: nothing in this feature writes, moves or deletes in the Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'
export const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Uploaded spreadsheet formats the platform already accepts, plus native Google Sheets. */
export const SUPPORTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const

export const DRIVE_FILE_STATUSES = ['new', 'changed', 'importing', 'imported', 'ignored', 'missing', 'error'] as const
export type DriveFileStatus = (typeof DRIVE_FILE_STATUSES)[number]

export const DRIVE_VALIDATION_STATUSES = [
  'none',
  'validating',
  'passed',
  'needs_validation',
  'blocked',
  'failed',
] as const
export type DriveValidationStatus = (typeof DRIVE_VALIDATION_STATUSES)[number]

/** The only two kinds the connector imports: the other formats need a store the file cannot give. */
export const DRIVE_IMPORTABLE_FILE_TYPES = ['sales', 'supply'] as const
export type DriveImportableFileType = (typeof DRIVE_IMPORTABLE_FILE_TYPES)[number]

/** Breadth-first depth from the root: root → month folder → (optional report folder) → file. */
export const DRIVE_MAX_TRAVERSAL_DEPTH = 3

/** Scan history kept for the status view; older rows are pruned. */
export const DRIVE_SCAN_RUNS_RETAINED = 30

/** Documented defaults. Every one of them is an environment setting (see drive.config.ts). */
export const DRIVE_DEFAULTS = {
  scanCron: '0 6 * * *',
  autoValidate: true,
  /** 25 MiB — the same limit as the gateway's manual upload (MAX_UPLOAD_BYTES). */
  maxFileBytes: 25 * 1024 * 1024,
  includePatterns: 'relat[oó]rio,abasteciment',
  syntheticPattern: 'sint[eé]tic|synthetic|\\[teste\\]',
  /** Share of dated rows that must fall inside the selected month. */
  periodMatchMinShare: 0.9,
  /** A weekday is "normal" for a store when it sold on at least this share of that weekday's occurrences. */
  weekdayOpenMinShare: 0.5,
  coverageMinPooled: 0.9,
  coverageMinStore: 0.7,
  /** Days the first/last dated row may sit inside the month boundaries before it is flagged. */
  edgeToleranceDays: 3,
} as const

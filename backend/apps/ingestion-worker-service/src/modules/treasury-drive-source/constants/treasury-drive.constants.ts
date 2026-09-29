export const TREASURY_DRIVE_QUEUES = {
  SCAN: 'treasury-drive.scan',
  IMPORT: 'treasury-drive.import',
} as const

export const TREASURY_DRIVE_SCHEDULER_ID = 'treasury-drive-scan'
export const TREASURY_DRIVE_TIME_ZONE = 'America/Sao_Paulo'
export const TREASURY_DRIVE_DEFAULT_SCAN_CRON = '0 6 * * *'
export const TREASURY_DRIVE_MAX_FILE_BYTES = 25 * 1024 * 1024

export const TREASURY_DRIVE_FILE_STATUSES = ['new', 'changed', 'importing', 'imported', 'ignored', 'error'] as const
export type TreasuryDriveFileStatus = (typeof TREASURY_DRIVE_FILE_STATUSES)[number]

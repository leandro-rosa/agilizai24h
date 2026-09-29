import { parseDriveCredential, type DriveCredential } from '../../drive-source/config/drive.config'
import { TREASURY_DRIVE_DEFAULT_SCAN_CRON } from '../constants/treasury-drive.constants'

export interface TreasuryDriveConfig {
  enabled: boolean
  rootFolderId?: string
  credential?: DriveCredential
  monthFolders: string[]
  scanCron: string
}

export const TREASURY_DRIVE_CONFIG = Symbol('TREASURY_DRIVE_CONFIG')

type Source = Record<string, unknown>

const text = (source: Source, name: string): string | undefined => {
  const value = source[name]
  if (value === undefined || value === null) return undefined
  const trimmed = String(value).trim()
  return trimmed === '' ? undefined : trimmed
}

export function loadTreasuryDriveConfig(source: Source): TreasuryDriveConfig {
  const rootFolderId = text(source, 'TREASURY_DRIVE_ROOT_FOLDER_ID')
  const { credential, problems } = parseDriveCredential(source)

  if (problems.length > 0) {
    throw new Error(`Invalid treasury Drive configuration:\n- ${problems.join('\n- ')}`)
  }

  const monthFolders = (text(source, 'TREASURY_DRIVE_MONTH_FOLDERS') ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(name => name !== '')

  return {
    enabled: rootFolderId !== undefined && credential !== undefined,
    rootFolderId,
    credential,
    monthFolders,
    scanCron: text(source, 'TREASURY_DRIVE_SCAN_CRON') ?? TREASURY_DRIVE_DEFAULT_SCAN_CRON,
  }
}

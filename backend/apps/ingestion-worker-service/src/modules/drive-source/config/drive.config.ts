import { existsSync } from 'node:fs'
import { DRIVE_DEFAULTS } from '../constants/drive.constants'
import type { ValidationThresholds } from '../types/validation.types'

export type DriveCredential = { kind: 'base64'; value: string } | { kind: 'file'; path: string }

export interface DriveConfig {
  /** True only when a root folder AND a credential are configured; otherwise the feature is inert. */
  enabled: boolean
  rootFolderId?: string
  credential?: DriveCredential
  /** Five- or six-field cron expression, evaluated in America/Sao_Paulo. */
  scanCron: string
  autoValidate: boolean
  maxFileBytes: number
  /** Regular-expression sources matched against accent-stripped, lower-cased names. */
  includePatterns: string[]
  syntheticPattern: string
  thresholds: ValidationThresholds
}

/** Injection token for the validated configuration, so no service reads the environment itself. */
export const DRIVE_CONFIG = Symbol('DRIVE_CONFIG')

/** Every environment variable of the Drive source, in one place for the module's config factory. */
export const DRIVE_ENV_KEYS = [
  'GOOGLE_DRIVE_ROOT_FOLDER_ID',
  'GOOGLE_SERVICE_ACCOUNT_JSON_BASE64',
  'GOOGLE_SERVICE_ACCOUNT_FILE',
  'DRIVE_SCAN_CRON',
  'DRIVE_AUTO_VALIDATE',
  'DRIVE_MAX_FILE_BYTES',
  'DRIVE_INCLUDE_PATTERNS',
  'DRIVE_SYNTHETIC_PATTERN',
  'DRIVE_PERIOD_MATCH_MIN_SHARE',
  'DRIVE_WEEKDAY_OPEN_MIN_SHARE',
  'DRIVE_COVERAGE_MIN_POOLED',
  'DRIVE_COVERAGE_MIN_STORE',
  'DRIVE_EDGE_TOLERANCE_DAYS',
] as const

type Source = Record<string, unknown>

const text = (source: Source, name: string): string | undefined => {
  const value = source[name]
  if (value === undefined || value === null) return undefined
  const trimmed = String(value).trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Builds the Drive configuration from environment values, applying the
 * documented defaults and failing at startup — not at the first scan — when the
 * setup is half-done or a value cannot be used. Errors name the VARIABLE only:
 * the credential is never echoed, not even when it is malformed.
 */
export function loadDriveConfig(source: Source, fileExists: (path: string) => boolean = existsSync): DriveConfig {
  const problems: string[] = []

  const number = (name: string, fallback: number, accept: (n: number) => boolean, expectation: string): number => {
    const raw = text(source, name)
    if (raw === undefined) return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || !accept(parsed)) {
      problems.push(`${name} must be ${expectation}`)
      return fallback
    }
    return parsed
  }

  const share = (name: string, fallback: number) =>
    number(name, fallback, n => n > 0 && n <= 1, 'a number greater than 0 and at most 1')

  const compiles = (name: string, pattern: string): boolean => {
    try {
      new RegExp(pattern, 'i')
      return true
    } catch {
      problems.push(`${name} contains a pattern that is not a valid regular expression`)
      return false
    }
  }

  const rootFolderId = text(source, 'GOOGLE_DRIVE_ROOT_FOLDER_ID')
  const base64 = text(source, 'GOOGLE_SERVICE_ACCOUNT_JSON_BASE64')
  const file = text(source, 'GOOGLE_SERVICE_ACCOUNT_FILE')

  let credential: DriveCredential | undefined

  if (base64 !== undefined && file !== undefined) {
    problems.push('set only one of GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 and GOOGLE_SERVICE_ACCOUNT_FILE')
  } else if (base64 !== undefined) {
    try {
      const parsed = JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as Record<string, unknown>
      if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
        problems.push('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 must decode to a service account key with client_email and private_key')
      } else {
        credential = { kind: 'base64', value: base64 }
      }
    } catch {
      problems.push('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64-encoded JSON')
    }
  } else if (file !== undefined) {
    if (fileExists(file)) credential = { kind: 'file', path: file }
    else problems.push('GOOGLE_SERVICE_ACCOUNT_FILE not found at the configured path')
  }

  const hasFolder = rootFolderId !== undefined
  const hasCredential = base64 !== undefined || file !== undefined

  if (hasFolder && !hasCredential) {
    problems.push('GOOGLE_DRIVE_ROOT_FOLDER_ID is set but neither GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 or GOOGLE_SERVICE_ACCOUNT_FILE is')
  }
  if (!hasFolder && hasCredential) {
    problems.push('a Drive credential is set but GOOGLE_DRIVE_ROOT_FOLDER_ID is not')
  }

  const scanCron = text(source, 'DRIVE_SCAN_CRON') ?? DRIVE_DEFAULTS.scanCron
  const cronFields = scanCron.split(/\s+/).length
  if (cronFields < 5 || cronFields > 6) {
    problems.push('DRIVE_SCAN_CRON must be a cron expression with five or six fields')
  }

  const autoValidateRaw = text(source, 'DRIVE_AUTO_VALIDATE')
  const autoValidate = autoValidateRaw === undefined ? DRIVE_DEFAULTS.autoValidate : autoValidateRaw.toLowerCase() !== 'false'

  const maxFileBytes = number('DRIVE_MAX_FILE_BYTES', DRIVE_DEFAULTS.maxFileBytes, n => Number.isInteger(n) && n > 0, 'a positive integer number of bytes')

  const includePatterns = (text(source, 'DRIVE_INCLUDE_PATTERNS') ?? DRIVE_DEFAULTS.includePatterns)
    .split(',')
    .map(pattern => pattern.trim())
    .filter(pattern => pattern !== '')
  for (const pattern of includePatterns) {
    if (!compiles('DRIVE_INCLUDE_PATTERNS', pattern)) break
  }

  const syntheticPattern = text(source, 'DRIVE_SYNTHETIC_PATTERN') ?? DRIVE_DEFAULTS.syntheticPattern
  compiles('DRIVE_SYNTHETIC_PATTERN', syntheticPattern)

  const thresholds: ValidationThresholds = {
    periodMatchMinShare: share('DRIVE_PERIOD_MATCH_MIN_SHARE', DRIVE_DEFAULTS.periodMatchMinShare),
    weekdayOpenMinShare: share('DRIVE_WEEKDAY_OPEN_MIN_SHARE', DRIVE_DEFAULTS.weekdayOpenMinShare),
    coverageMinPooled: share('DRIVE_COVERAGE_MIN_POOLED', DRIVE_DEFAULTS.coverageMinPooled),
    coverageMinStore: share('DRIVE_COVERAGE_MIN_STORE', DRIVE_DEFAULTS.coverageMinStore),
    edgeToleranceDays: number('DRIVE_EDGE_TOLERANCE_DAYS', DRIVE_DEFAULTS.edgeToleranceDays, n => Number.isInteger(n) && n >= 0, 'a non-negative integer number of days'),
  }

  if (problems.length > 0) {
    throw new Error(`Invalid Drive configuration:\n- ${problems.join('\n- ')}`)
  }

  return {
    enabled: hasFolder && credential !== undefined,
    rootFolderId,
    credential,
    scanCron,
    autoValidate,
    maxFileBytes,
    includePatterns,
    syntheticPattern,
    thresholds,
  }
}

/** The configuration as it may be logged or returned by the status endpoint: never the credential. */
export function describeDriveConfig(config: DriveConfig): Record<string, unknown> {
  return {
    enabled: config.enabled,
    rootFolderConfigured: config.rootFolderId !== undefined,
    credentialConfigured: config.credential !== undefined,
    scanCron: config.scanCron,
    autoValidate: config.autoValidate,
    maxFileBytes: config.maxFileBytes,
    includePatterns: config.includePatterns,
    thresholds: config.thresholds,
  }
}

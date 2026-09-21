import type { DriveImportableFileType } from '../constants/drive.constants'
import type {
  ContentSummary,
  DetectedFormat,
  Finding,
  ValidationOutcome,
  ValidationReport,
  ValidationThresholds,
} from '../types/validation.types'
import { evaluateCoverage } from './coverage'

/** The month holding most of the dated rows; a tie goes to the earlier month so key order never matters. */
export function dominantMonth(histogram: Record<string, number>): string | null {
  const entries = Object.entries(histogram).filter(([, count]) => count > 0)
  if (entries.length === 0) return null

  return entries.sort(([monthA, a], [monthB, b]) => b - a || monthA.localeCompare(monthB))[0][0]
}

/** Share of the dated rows that fall in `period`; null when the file has no dated rows at all. */
export function periodShare(histogram: Record<string, number>, period: string): number | null {
  const total = Object.values(histogram).reduce((sum, count) => sum + count, 0)
  if (total === 0) return null

  return (histogram[period] ?? 0) / total
}

/** The type a file's structure implies; the structure, not the name, is what decides. */
export function typeFromFormat(format: DetectedFormat): DriveImportableFileType | null {
  if (format === 'network_sales') return 'sales'
  if (format === 'supply') return 'supply'
  return null
}

export function checkSize(sizeBytes: number, maxBytes: number): Finding | null {
  if (sizeBytes <= maxBytes) return null

  return {
    code: 'too_large',
    message: `The file is ${sizeBytes} bytes, above the ${maxBytes}-byte limit`,
    details: { sizeBytes, maxBytes },
  }
}

export interface ImportedRecord {
  id: string
  path: string
  sha256: string
  fileType: string
  period: string
  importedAt: string | null
}

/** The earlier import of identical content for the same type and period, if any, other than the file itself. */
export function findDuplicate(
  candidate: { sha256: string; fileType: string; period: string; exceptId?: string },
  imported: ImportedRecord[],
): ImportedRecord | null {
  return (
    imported.find(
      record =>
        record.id !== candidate.exceptId &&
        record.sha256 === candidate.sha256 &&
        record.fileType === candidate.fileType &&
        record.period === candidate.period,
    ) ?? null
  )
}

export interface EvaluateInput {
  summary: ContentSummary
  /** The type stated or suggested; null lets the structure of the file decide. */
  fileType: DriveImportableFileType | null
  /** The period stated or suggested (`YYYY-MM`); null lets the dates in the file decide. */
  period: string | null
  sizeBytes: number
  contentSha256: string
  /** The date in America/Sao_Paulo, `YYYY-MM-DD`: the end of a month that is still running. */
  today: string
  thresholds: ValidationThresholds
  maxFileBytes: number
  /** Resolved by the caller from the imported files; the pure checks only name it. */
  duplicateOf?: { id: string; path: string; importedAt: string | null } | null
  isSynthetic?: boolean
}

/**
 * Runs every check against the aggregated content of a file and returns the
 * stored report. Nothing here reads a row: the input is counts, day masks and
 * findings, which is why a period or type change can be re-evaluated without
 * downloading the file again.
 *
 * Two outcomes are deliberately different. A BLOCKING finding — a wrong period,
 * a wrong format, a duplicate, an oversized or synthetic file — leaves nothing
 * to review: fix it and validate again. An INCONSISTENCY — coverage below the
 * bar — is something a person can look at and decide to accept, so it asks for
 * an explicit validation instead of refusing.
 */
export function evaluateValidation(input: EvaluateInput): ValidationReport {
  const { summary, thresholds } = input
  const blocking: Finding[] = []

  const structureType = typeFromFormat(summary.format)

  if (summary.format === 'legacy_store_sales') {
    blocking.push({
      code: 'legacy_format',
      message: 'This is the old per-store sales report, which needs a store and must be uploaded manually',
    })
  } else if (summary.format === 'unknown') {
    blocking.push({ code: 'unknown_format', message: 'The structure of the file was not recognised as a sales or restocking report' })
  } else if (input.fileType !== null && structureType !== input.fileType) {
    blocking.push({
      code: 'format_mismatch',
      message: `The file was stated as ${input.fileType} but its structure is ${structureType}`,
      details: { expected: input.fileType, found: structureType },
    })
  }

  const fileType = input.fileType ?? structureType
  const dominant = dominantMonth(summary.monthHistogram)
  const period = input.period ?? dominant
  const share = period === null ? null : periodShare(summary.monthHistogram, period)

  if (period === null || share === null) {
    blocking.push({ code: 'no_readable_dates', message: 'The period could not be verified: the file has no readable dates' })
  } else if (share < thresholds.periodMatchMinShare) {
    blocking.push({
      code: 'period_mismatch',
      message: `Only ${(share * 100).toFixed(1)}% of the dated rows fall in ${period}; most are in ${dominant}`,
      details: { period, observedMonth: dominant, share, minimum: thresholds.periodMatchMinShare },
    })
  }

  const oversized = checkSize(input.sizeBytes, input.maxFileBytes)
  if (oversized) blocking.push(oversized)

  if (input.duplicateOf) {
    blocking.push({
      code: 'duplicate',
      message: 'The content is identical to a file already imported for this type and period',
      details: { of: input.duplicateOf.id, path: input.duplicateOf.path, importedAt: input.duplicateOf.importedAt },
    })
  }

  if (input.isSynthetic) {
    blocking.push({ code: 'synthetic', message: 'The file is marked as synthetic and can never be imported into real data' })
  }

  // Coverage is measured only where there is a daily grain to measure: a network sales file.
  const coverage =
    fileType === 'sales' && summary.format === 'network_sales' && period !== null && share !== null
      ? evaluateCoverage(summary.storeDays[period] ?? {}, period, input.today, thresholds)
      : null

  const inconsistencies = coverage?.inconsistencies ?? []

  const outcome: ValidationOutcome = blocking.length > 0 ? 'blocked' : inconsistencies.length > 0 ? 'needs_validation' : 'passed'

  return {
    version: 1,
    outcome,
    format: summary.format,
    fileType,
    period,
    rowCount: summary.rowCount,
    sizeBytes: input.sizeBytes,
    contentSha256: input.contentSha256,
    monthHistogram: summary.monthHistogram,
    dominantMonth: dominant,
    periodShare: share,
    firstDay: coverage?.firstDay ?? null,
    lastDay: coverage?.lastDay ?? null,
    fileCoverage: coverage?.fileCoverage ?? null,
    stores: coverage?.stores ?? [],
    blocking,
    inconsistencies,
    thresholds,
  }
}

/**
 * The report of a file that is refused WITHOUT reading it: a synthetic file, or one
 * the Drive already says is over the size limit. Nothing about its content is known,
 * and none is fetched — a synthetic file must not even be downloaded.
 */
export function blockedWithoutContent(input: {
  finding: Finding
  fileType: DriveImportableFileType | null
  period: string | null
  sizeBytes: number
  thresholds: ValidationThresholds
}): ValidationReport {
  return {
    version: 1,
    outcome: 'blocked',
    format: 'unknown',
    fileType: input.fileType,
    period: input.period,
    rowCount: 0,
    sizeBytes: input.sizeBytes,
    contentSha256: '',
    monthHistogram: {},
    dominantMonth: null,
    periodShare: null,
    firstDay: null,
    lastDay: null,
    fileCoverage: null,
    stores: [],
    blocking: [input.finding],
    inconsistencies: [],
    thresholds: input.thresholds,
  }
}

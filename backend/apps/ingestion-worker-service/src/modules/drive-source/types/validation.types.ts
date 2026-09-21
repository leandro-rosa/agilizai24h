import type { DriveImportableFileType } from '../constants/drive.constants'

/** Every threshold of the validation checks; each is an environment setting (drive.config.ts). */
export interface ValidationThresholds {
  /** Share of dated rows that must fall inside the selected month. */
  periodMatchMinShare: number
  /** A weekday is normal for a store when it sold on at least this share of that weekday's occurrences. */
  weekdayOpenMinShare: number
  /** File-level coverage (pooled across verifiable stores) below this needs validation. */
  coverageMinPooled: number
  /** Store-level coverage below this needs validation. */
  coverageMinStore: number
  /** Days the first/last dated row may sit inside the month boundaries. */
  edgeToleranceDays: number
}

export type DetectedFormat = 'network_sales' | 'legacy_store_sales' | 'supply' | 'unknown'

/**
 * What a sales file contributes to coverage for one store in one month: how many
 * rows it has and WHICH days have at least one row (any result). A day mask is a
 * bit per day of the month — bit 0 is day 1 — so 31 days fit in a 32-bit integer
 * and nothing row-level, no card digits and no buyer numbers, is ever kept.
 */
export interface StoreDays {
  rows: number
  dayMask: number
}

/**
 * The aggregated content of a file, built once while the file sits in a
 * temporary path and kept in place of the file itself. It is the ONLY thing the
 * checks read, which is why a period or type change can be re-evaluated from it
 * without downloading the file again.
 */
export interface ContentSummary {
  format: DetectedFormat
  /** Every row read, dated or not. */
  rowCount: number
  /** Rows (sales) or operations (supply) with a readable date, by month "YYYY-MM". */
  monthHistogram: Record<string, number>
  /** Rows or operations without a readable date. */
  undatedRows: number
  /** Sales only: month → store name → row count and day mask. */
  storeDays: Record<string, Record<string, StoreDays>>
}

/** One thing a check found: a stable `code` for the UI and a message for a person. */
export interface Finding {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface StoreCoverage {
  name: string
  rows: number
  /** 0 = Sunday … 6 = Saturday, the weekdays on which the store normally sells. */
  normalWeekdays: number[]
  expectedDays: number
  coveredDays: number
  /** Null when the store's coverage cannot be established. */
  coverage: number | null
  verifiable: boolean
  /** Expected days with no row, as YYYY-MM-DD, capped. */
  missingDates: string[]
}

export type ValidationOutcome = 'passed' | 'needs_validation' | 'blocked'

/** The stored result of validating a file: aggregates and findings, never content. */
export interface ValidationReport {
  version: 1
  outcome: ValidationOutcome
  format: DetectedFormat
  /** The type and period the file was evaluated against. */
  fileType: DriveImportableFileType | null
  period: string | null
  rowCount: number
  sizeBytes: number
  contentSha256: string
  monthHistogram: Record<string, number>
  dominantMonth: string | null
  /** Share of dated rows inside `period`; null when it cannot be computed. */
  periodShare: number | null
  firstDay: string | null
  lastDay: string | null
  /** Pooled coverage over verifiable stores; null for restocking or when nothing is verifiable. */
  fileCoverage: number | null
  stores: StoreCoverage[]
  /** Reasons the file cannot be imported until they are fixed and it is validated again. */
  blocking: Finding[]
  /** Reasons a person has to review and confirm before importing. */
  inconsistencies: Finding[]
  /** The thresholds applied, so the result can be reproduced. */
  thresholds: ValidationThresholds
}

/**
 * What `drive_file.validation_report` holds: the report shown to a person, and the
 * aggregated content it was computed from. Keeping the content (counts and day
 * masks, never a row) is what lets a change of period or type be re-evaluated
 * without downloading the file again.
 */
export interface StoredValidation {
  report: ValidationReport
  content: ContentSummary
}

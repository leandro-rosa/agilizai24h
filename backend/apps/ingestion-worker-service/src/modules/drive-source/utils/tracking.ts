import { GOOGLE_SHEET_MIME, SUPPORTED_EXTENSIONS, XLSX_MIME } from '../constants/drive.constants'

/** Lower-cased and stripped of accents, the form every pattern and month name is compared in. */
export function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const anyMatches = (segments: string[], patterns: string[]): boolean => {
  const regexes = patterns.map(pattern => new RegExp(pattern, 'i'))

  return segments.some(segment => {
    const normalized = normalizeName(segment)
    return regexes.some(regex => regex.test(normalized))
  })
}

/**
 * Whether a file is tracked at all: its own name, or the name of a folder
 * between its month folder and itself, must match one of the configured
 * patterns. That is what keeps the tens of legacy per-store files out of the
 * list without a hard-coded name.
 */
export function matchesIncludePatterns(segmentsBelowMonthFolder: string[], patterns: string[]): boolean {
  return anyMatches(segmentsBelowMonthFolder, patterns)
}

/**
 * A synthetic or test file, marked in its name or in any folder above it. It is
 * tracked so it can be seen and labelled, and never imported: synthetic data must
 * not reach the real databases.
 */
export function isSynthetic(pathSegments: string[], pattern: string): boolean {
  return anyMatches(pathSegments, [pattern])
}

const SUPPORTED_MIMES = new Set([XLSX_MIME, GOOGLE_SHEET_MIME, 'application/vnd.ms-excel', 'text/csv'])

/** A spreadsheet the platform can read: xlsx, xls, csv or a native Google Sheet; never a folder or a lock file. */
export function isSupportedFile(item: { name: string; mimeType: string; isFolder: boolean }): boolean {
  if (item.isFolder) return false
  // Excel writes "~$name" next to an open workbook; it is not a readable spreadsheet.
  if (item.name.startsWith('~$')) return false

  const lower = item.name.toLowerCase()

  return SUPPORTED_MIMES.has(item.mimeType) || SUPPORTED_EXTENSIONS.some(extension => lower.endsWith(extension))
}

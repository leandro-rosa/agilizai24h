import type { DriveImportableFileType } from '../constants/drive.constants'
import { normalizeName } from './tracking'

/**
 * Suggestions are proposals for a person to confirm, never facts. They come
 * from names only (folder path and file name) and are EMPTY, with a reason,
 * whenever the name does not settle the question: guessing a period is how a
 * March report ends up attributed to April.
 */

export interface PeriodSuggestion {
  period: string | null
  /** Why the period is empty: `no_month`, `no_year`, `ambiguous_month`, `ambiguous_year`. */
  note: string | null
}

export interface TypeSuggestion {
  fileType: DriveImportableFileType | null
  /** `generic_name` (a bare "Relatório", to be confirmed by the content), `ambiguous_name`, `unknown_name`. */
  note: string | null
}

export interface Suggestion {
  fileType: DriveImportableFileType | null
  period: string | null
  /** The one reason worth showing: a period problem first, then where the period came from, then the type. */
  note: string | null
}

const MONTHS: Record<string, number> = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
}

const pad = (month: number) => String(month).padStart(2, '0')
const tokens = (normalized: string) => normalized.split(/[^a-z0-9]+/).filter(Boolean)
const fourDigitYears = (list: string[]) => list.filter(token => /^20\d{2}$/.test(token)).map(Number)

interface ParsedSegment {
  months: number[]
  /** The year written in the same segment as the month, when there is one. */
  ownYear: number | null
  /** Every four-digit year in the segment, for use as a hint by other segments. */
  years: number[]
}

function parseSegment(raw: string): ParsedSegment {
  const normalized = normalizeName(raw).trim()

  const yearMonth = /^(20\d{2})[-_.](0?[1-9]|1[0-2])$/.exec(normalized)
  if (yearMonth) return { months: [Number(yearMonth[2])], ownYear: Number(yearMonth[1]), years: [Number(yearMonth[1])] }

  const monthYear = /^(0?[1-9]|1[0-2])[-_.](20\d{2})$/.exec(normalized)
  if (monthYear) return { months: [Number(monthYear[1])], ownYear: Number(monthYear[2]), years: [Number(monthYear[2])] }

  const monthOnly = /^(0?[1-9]|1[0-2])$/.exec(normalized)
  if (monthOnly) return { months: [Number(monthOnly[1])], ownYear: null, years: [] }

  const parts = tokens(normalized)
  const monthIndexes = parts.map((token, index) => (token in MONTHS ? index : -1)).filter(index => index >= 0)
  const months = [...new Set(monthIndexes.map(index => MONTHS[parts[index]]))]
  const years = fourDigitYears(parts)

  let ownYear: number | null = null
  if (months.length === 1) {
    const after = parts[monthIndexes[0] + 1]
    // A two-digit year only counts right after the month ("março-26"); alone it could be a day.
    if (years.length > 0) ownYear = years[0]
    else if (after !== undefined && /^\d{2}$/.test(after)) ownYear = 2000 + Number(after)
  }

  return { months, ownYear, years }
}

/**
 * The period of a file, from its folder path (root → parent) and, as a year
 * hint only, its file name. The month comes from a month folder; the year from
 * the same folder's suffix, else from any other folder or the file name, and
 * is empty when those disagree.
 */
export function suggestPeriod(folderSegments: string[], fileName?: string): PeriodSuggestion {
  const parsed = folderSegments.map(parseSegment)
  const monthSegments = parsed.filter(segment => segment.months.length > 0)
  const allMonths = new Set(monthSegments.flatMap(segment => segment.months))

  if (allMonths.size === 0) return { period: null, note: 'no_month' }
  if (allMonths.size > 1) return { period: null, note: 'ambiguous_month' }

  const month = [...allMonths][0]
  const monthSegment = monthSegments[0]

  let year = monthSegment.ownYear

  if (year === null) {
    const hints = new Set<number>()
    for (const segment of parsed) for (const value of segment.years) hints.add(value)
    if (fileName) for (const value of fourDigitYears(tokens(normalizeName(fileName)))) hints.add(value)

    if (hints.size === 0) return { period: null, note: 'no_year' }
    if (hints.size > 1) return { period: null, note: 'ambiguous_year' }
    year = [...hints][0]
  }

  return { period: `${year}-${pad(month)}`, note: null }
}

/** The kind of report from its name; a bare "Relatório" is sales, to be confirmed by what is inside. */
export function suggestFileType(fileName: string, extraSegments: string[] = []): TypeSuggestion {
  for (const candidate of [fileName, ...extraSegments]) {
    const normalized = normalizeName(candidate)
    const supply = normalized.includes('abasteciment')
    const report = normalized.includes('relatorio')

    if (supply && report) return { fileType: null, note: 'ambiguous_name' }
    if (supply) return { fileType: 'supply', note: null }
    if (report) return { fileType: 'sales', note: 'generic_name' }
  }

  return { fileType: null, note: 'unknown_name' }
}

/** The month of a date range written in a report's name, when the range sits inside one month. */
export function periodFromFileName(fileName: string): string | null {
  const months = new Set<string>()

  for (const match of fileName.matchAll(/(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/g)) {
    months.add(`${match[1]}-${match[2]}`)
  }

  return months.size === 1 ? [...months][0] : null
}

/** Folder path (root → parent) and file name together: the proposal shown next to a file. */
export function suggest(folderSegments: string[], fileName: string): Suggestion {
  const type = suggestFileType(fileName, folderSegments)
  const folder = suggestPeriod(folderSegments, fileName)
  const named = periodFromFileName(fileName)

  if (folder.period && named && folder.period !== named) {
    return { fileType: type.fileType, period: null, note: 'conflict' }
  }
  if (!folder.period && named) {
    return { fileType: type.fileType, period: named, note: 'period_from_file_name' }
  }

  return { fileType: type.fileType, period: folder.period, note: folder.note ?? type.note }
}

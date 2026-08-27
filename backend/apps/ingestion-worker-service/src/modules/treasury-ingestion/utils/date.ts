/**
 * `DD/MM/YYYY` → ISO `YYYY-MM-DD`, or `null` for a value that merely LOOKS
 * like a date (matches the digit shape) but is not one. Found by a real test
 * failure: matching only the digit shape let "32/13/2026" through as a valid
 * date.
 */
export function parseBrDate(day: string, month: string, year: string): string | null {
  const dayNum = Number(day)
  const monthNum = Number(month)
  if (monthNum < 1 || monthNum > 12) return null

  const daysInMonth = new Date(Number(year), monthNum, 0).getDate()
  if (dayNum < 1 || dayNum > daysInMonth) return null

  return `${year}-${month}-${day}`
}

const PT_MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
}

/** "abr"/"ABR" → 4, `null` for anything else — C6's fatura ("01 abr") and Nubank's day-header
 * ("13 JAN 2026") both use this 3-letter form, never a full month name. */
export function monthFromPtAbbreviation(text: string): number | null {
  return PT_MONTH_ABBREVIATIONS[text.trim().toLowerCase()] ?? null
}

/**
 * Resolves a day+month with no year against the uploader-supplied `period`
 * (`YYYY-MM`) — the only source of truth available for C6's fatura, which
 * states no year anywhere near a purchase line (checked: not in the PDF's
 * own metadata either, whose `CreationDate` is the issuance date, not
 * reliably the transaction month). Rolls back a year when the parsed month
 * is more than one month after the period's own month — a fatura due
 * mid-month can carry a day from the tail of the prior month, but never
 * several months ahead of its own period.
 */
export function resolveYearFromPeriod(day: number, month: number, period: string): string | null {
  const [periodYear, periodMonth] = period.split('-').map(Number)
  const year = month - periodMonth > 1 ? periodYear - 1 : periodYear
  return parseBrDate(String(day).padStart(2, '0'), String(month).padStart(2, '0'), String(year))
}

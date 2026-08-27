import { monthFromPtAbbreviation, parseBrDate, resolveYearFromPeriod } from './date'

describe('parseBrDate', () => {
  it('converts a valid date to ISO', () => {
    expect(parseBrDate('15', '07', '2026')).toBe('2026-07-15')
  })

  // Regression: an earlier version only checked the digit SHAPE (\d{2}), so
  // "32/13/2026" passed as if it were a real date.
  it('rejects a day beyond the month length', () => {
    expect(parseBrDate('32', '13', '2026')).toBeNull()
  })

  it('rejects month 13', () => {
    expect(parseBrDate('01', '13', '2026')).toBeNull()
  })

  it('rejects day 31 in a 30-day month', () => {
    expect(parseBrDate('31', '04', '2026')).toBeNull()
  })

  it('accepts 29 February on a leap year', () => {
    expect(parseBrDate('29', '02', '2028')).toBe('2028-02-29')
  })

  it('rejects 29 February on a non-leap year', () => {
    expect(parseBrDate('29', '02', '2026')).toBeNull()
  })
})

describe('monthFromPtAbbreviation', () => {
  it('resolves a lowercase 3-letter abbreviation', () => {
    expect(monthFromPtAbbreviation('abr')).toBe(4)
  })

  it('is case-insensitive (Nubank uses uppercase)', () => {
    expect(monthFromPtAbbreviation('JAN')).toBe(1)
  })

  it('returns null for anything else', () => {
    expect(monthFromPtAbbreviation('abril')).toBeNull()
    expect(monthFromPtAbbreviation('xx')).toBeNull()
  })
})

describe('resolveYearFromPeriod', () => {
  it('uses the period year when the month is within the period', () => {
    expect(resolveYearFromPeriod(15, 6, '2026-06')).toBe('2026-06-15')
  })

  // Regression: a C6 fatura for the June period ("01 de Junho" vencimento)
  // can carry a late-May purchase — same year, not a rollover case.
  it('does not roll back a year for the month right before the period', () => {
    expect(resolveYearFromPeriod(28, 5, '2026-06')).toBe('2026-05-28')
  })

  // A fatura closing in January can carry a purchase from December of the
  // prior year — no year appears anywhere near the line itself, so the
  // period is the only source of truth.
  it('rolls back a year when the month is well after the period month', () => {
    expect(resolveYearFromPeriod(28, 12, '2026-01')).toBe('2025-12-28')
  })

  it('returns null for an invalid day/month combination', () => {
    expect(resolveYearFromPeriod(31, 4, '2026-04')).toBeNull()
  })
})

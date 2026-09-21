import { periodFromFileName, suggest, suggestFileType, suggestPeriod } from './suggestions'

describe('suggestPeriod', () => {
  it.each([
    [['agosto-26'], '2026-08'],
    [['Março-26'], '2026-03'],
    [['julho-26'], '2026-07'],
    [['AGOSTO-26'], '2026-08'],
    [['ago-26'], '2026-08'],
    [['set_2026'], '2026-09'],
    [['agosto_2026'], '2026-08'],
    [['2026-08'], '2026-08'],
    [['08-2026'], '2026-08'],
  ])('reads %j as %s from the folder name alone', (segments, expected) => {
    expect(suggestPeriod(segments)).toEqual({ period: expected, note: null })
  })

  it('takes the year from the file name when the folder has none: the real Relatório_2026 sits in a month folder', () => {
    expect(suggestPeriod(['agosto'], 'Relatório_2026.xlsx')).toEqual({ period: '2026-08', note: null })
  })

  it('takes the year from a report folder inside the month folder', () => {
    expect(suggestPeriod(['agosto', 'Relatório_2026'])).toEqual({ period: '2026-08', note: null })
  })

  it('takes the year from an ancestor folder', () => {
    expect(suggestPeriod(['relatórios_2026', 'agosto'])).toEqual({ period: '2026-08', note: null })
    expect(suggestPeriod(['08', 'relatórios_2026'])).toEqual({ period: '2026-08', note: null })
  })

  it('prefers the year written in the month folder itself', () => {
    expect(suggestPeriod(['agosto-26', 'Relatório_2025'])).toEqual({ period: '2026-08', note: null })
  })

  it('does not take the first day of a date for a month or a year', () => {
    expect(suggestPeriod(['agosto'], 'Abastecimentos 2026-07-01 _ 2026-07-31.xlsx')).toEqual({ period: '2026-08', note: null })
  })

  it('is empty, with the reason, when there is a month and no year anywhere', () => {
    expect(suggestPeriod(['agosto'])).toEqual({ period: null, note: 'no_year' })
  })

  it('is empty when the folder is not a month', () => {
    expect(suggestPeriod(['outros'])).toEqual({ period: null, note: 'no_month' })
    expect(suggestPeriod(['marmita-2026'])).toEqual({ period: null, note: 'no_month' })
    expect(suggestPeriod([])).toEqual({ period: null, note: 'no_month' })
  })

  it('is empty when a name yields two different months', () => {
    expect(suggestPeriod(['agosto e setembro-26'])).toEqual({ period: null, note: 'ambiguous_month' })
  })

  it('is empty when the year sources disagree with each other', () => {
    expect(suggestPeriod(['agosto', 'Relatório_2025'], 'Relatório_2026.xlsx')).toEqual({ period: null, note: 'ambiguous_year' })
  })
})

describe('suggestFileType', () => {
  it('reads the restocking report from its name', () => {
    expect(suggestFileType('Abastecimentos 2026-07-01 _ 2026-07-31.xlsx')).toEqual({ fileType: 'supply', note: null })
  })

  it('reads a generic "Relatório" as sales, and says the content must confirm it', () => {
    expect(suggestFileType('Relatório_2026.xlsx')).toEqual({ fileType: 'sales', note: 'generic_name' })
  })

  it('is empty when the name says both, or neither', () => {
    expect(suggestFileType('relatorio de abastecimento.xlsx')).toEqual({ fileType: null, note: 'ambiguous_name' })
    expect(suggestFileType('planilha.xlsx')).toEqual({ fileType: null, note: 'unknown_name' })
  })
})

describe('periodFromFileName', () => {
  it('reads the month of a date range written in a restocking report name', () => {
    expect(periodFromFileName('Abastecimentos 2026-07-01 _ 2026-07-31.xlsx')).toBe('2026-07')
  })

  it('is null when the range spans two months, since one month cannot be suggested', () => {
    expect(periodFromFileName('Abastecimentos 2026-07-15 _ 2026-08-14.xlsx')).toBeNull()
  })

  it('is null when the name carries no date', () => {
    expect(periodFromFileName('Relatório_2026.xlsx')).toBeNull()
  })
})

describe('suggest (folder path and file name together)', () => {
  it('a sales report in a month folder', () => {
    expect(suggest(['agosto-26'], 'Relatório_2026.xlsx')).toEqual({ fileType: 'sales', period: '2026-08', note: 'generic_name' })
  })

  it('a restocking report named with a date range, in the matching folder', () => {
    expect(suggest(['julho-26'], 'Abastecimentos 2026-07-01 _ 2026-07-31.xlsx')).toEqual({
      fileType: 'supply',
      period: '2026-07',
      note: null,
    })
  })

  it('leaves the period empty, with the reason "conflict", when folder and file name disagree', () => {
    expect(suggest(['agosto-26'], 'Abastecimentos 2026-07-01 _ 2026-07-31.xlsx')).toEqual({
      fileType: 'supply',
      period: null,
      note: 'conflict',
    })
  })

  it('falls back to the file name when the folder is not a month', () => {
    expect(suggest(['arquivo-morto'], 'Abastecimentos 2026-07-01 _ 2026-07-31.xlsx')).toEqual({
      fileType: 'supply',
      period: '2026-07',
      note: 'period_from_file_name',
    })
  })

  it('reads the type from a report folder when the spreadsheet inside has a generic name', () => {
    expect(suggest(['agosto', 'Relatório_2026'], 'dados.xlsx')).toEqual({ fileType: 'sales', period: '2026-08', note: 'generic_name' })
  })

  it('leaves both empty for an unrecognised folder and name', () => {
    expect(suggest(['outros'], 'planilha.xlsx')).toEqual({ fileType: null, period: null, note: 'no_month' })
  })
})

import { DRIVE_DEFAULTS } from '../constants/drive.constants'
import { isSupportedFile, isSynthetic, matchesIncludePatterns, normalizeName } from './tracking'

const includePatterns = DRIVE_DEFAULTS.includePatterns.split(',')
const syntheticPattern = DRIVE_DEFAULTS.syntheticPattern

describe('normalizeName', () => {
  it('lower-cases and strips accents so a pattern written without them still matches', () => {
    expect(normalizeName('Relatório_2026')).toBe('relatorio_2026')
    expect(normalizeName('MARÇO-26')).toBe('marco-26')
  })
})

describe('matchesIncludePatterns', () => {
  it.each([
    [['Relatório_2026.xlsx']],
    [['relatorio_2026']],
    [['Abastecimentos 2026-07-01 _ 2026-07-31.xlsx']],
    [['ABASTECIMENTO JULHO.xlsx']],
  ])('tracks %j', segments => {
    expect(matchesIncludePatterns(segments, includePatterns)).toBe(true)
  })

  it('tracks a spreadsheet inside a folder named like the report: the folder is what matches', () => {
    expect(matchesIncludePatterns(['Relatório_2026', 'vendas agosto.xlsx'], includePatterns)).toBe(true)
  })

  it('skips the legacy per-store files, so twenty of them do not clutter the list', () => {
    const legacy = Array.from({ length: 20 }, (_, i) => `venda Ascenty - LOJA${i} agosto.xlsx`)

    expect(legacy.filter(name => matchesIncludePatterns([name], includePatterns))).toEqual([])
  })

  it('skips anything else', () => {
    expect(matchesIncludePatterns(['planilha de precos.xlsx'], includePatterns)).toBe(false)
    expect(matchesIncludePatterns([], includePatterns)).toBe(false)
  })

  it('uses whatever patterns are configured', () => {
    expect(matchesIncludePatterns(['fechamento.xlsx'], ['fechamento'])).toBe(true)
    expect(matchesIncludePatterns(['Relatório_2026.xlsx'], ['fechamento'])).toBe(false)
  })
})

describe('isSynthetic', () => {
  it.each([
    [['[TESTE] Relatório_2026.xlsx']],
    [['relatorio sintético.xlsx']],
    [['Sintetico', 'Relatório_2026.xlsx']],
    [['SYNTHETIC_report.xlsx']],
  ])('marks %j as synthetic', segments => {
    expect(isSynthetic(segments, syntheticPattern)).toBe(true)
  })

  it('does not mark a real report', () => {
    expect(isSynthetic(['agosto-26', 'Relatório_2026.xlsx'], syntheticPattern)).toBe(false)
  })
})

describe('isSupportedFile', () => {
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const item = (name: string, mimeType: string, isFolder = false) => ({ name, mimeType, isFolder })

  it.each([
    ['Relatório_2026.xlsx', xlsx],
    ['antigo.xls', 'application/vnd.ms-excel'],
    ['dados.csv', 'text/csv'],
    ['Relatório_2026', 'application/vnd.google-apps.spreadsheet'],
    ['Relatório_2026', xlsx],
  ])('accepts %s (%s)', (name, mimeType) => {
    expect(isSupportedFile(item(name, mimeType))).toBe(true)
  })

  it.each([
    ['~$Relatório_2026.xlsx', xlsx],
    ['Relatório_2026.pdf', 'application/pdf'],
    ['foto.png', 'image/png'],
    ['pasta', 'application/vnd.google-apps.folder'],
  ])('refuses %s (%s)', (name, mimeType) => {
    expect(isSupportedFile(item(name, mimeType, mimeType.endsWith('folder')))).toBe(false)
  })

  it('accepts a supported extension even when the Drive reports a generic mime type', () => {
    expect(isSupportedFile(item('Relatório_2026.xlsx', 'application/octet-stream'))).toBe(true)
  })
})

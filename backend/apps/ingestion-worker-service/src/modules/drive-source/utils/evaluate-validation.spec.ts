import type { ContentSummary, StoreDays, ValidationThresholds } from '../types/validation.types'
import {
  blockedWithoutContent,
  checkSize,
  dominantMonth,
  evaluateValidation,
  findDuplicate,
  periodShare,
  typeFromFormat,
  type EvaluateInput,
} from './evaluate-validation'

const thresholds: ValidationThresholds = {
  periodMatchMinShare: 0.9,
  weekdayOpenMinShare: 0.5,
  coverageMinPooled: 0.9,
  coverageMinStore: 0.7,
  edgeToleranceDays: 3,
}

const MiB = 1024 * 1024
const maskOf = (days: number[]) => days.reduce((mask, day) => mask | (1 << (day - 1)), 0)
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const everyDay = (from = 1, to = 31): StoreDays => ({ rows: 400, dayMask: maskOf(range(from, to)) })

/** A complete network sales file for August 2026: two stores, every day. */
const salesSummary = (overrides: Partial<ContentSummary> = {}): ContentSummary => ({
  format: 'network_sales',
  rowCount: 800,
  monthHistogram: { '2026-08': 800 },
  undatedRows: 0,
  storeDays: { '2026-08': { 'Ascenty - ADM': everyDay(), 'Plena Saude - Taipas': everyDay() } },
  ...overrides,
})

const input = (overrides: Partial<EvaluateInput> = {}): EvaluateInput => ({
  summary: salesSummary(),
  fileType: 'sales',
  period: '2026-08',
  sizeBytes: 2 * MiB,
  contentSha256: 'sha-abc',
  today: '2026-09-19',
  thresholds,
  maxFileBytes: 25 * MiB,
  ...overrides,
})

const codes = (findings: { code: string }[]) => findings.map(f => f.code)

describe('period identity helpers', () => {
  it('finds the month that holds most of the dated rows', () => {
    expect(dominantMonth({ '2026-07': 80, '2026-08': 20 })).toBe('2026-07')
    expect(dominantMonth({})).toBeNull()
  })

  it('breaks a tie towards the earlier month, so the answer never depends on key order', () => {
    expect(dominantMonth({ '2026-08': 50, '2026-07': 50 })).toBe('2026-07')
  })

  it('is the share of dated rows inside the period, and null when there are no dated rows', () => {
    expect(periodShare({ '2026-07': 80, '2026-08': 20 }, '2026-08')).toBeCloseTo(0.2, 10)
    expect(periodShare({ '2026-08': 95, '2026-09': 5 }, '2026-08')).toBeCloseTo(0.95, 10)
    expect(periodShare({}, '2026-08')).toBeNull()
  })
})

describe('typeFromFormat', () => {
  it('reads the type from the structure of the file', () => {
    expect(typeFromFormat('network_sales')).toBe('sales')
    expect(typeFromFormat('supply')).toBe('supply')
    expect(typeFromFormat('legacy_store_sales')).toBeNull()
    expect(typeFromFormat('unknown')).toBeNull()
  })
})

describe('checkSize', () => {
  it('blocks a file over the limit and accepts one exactly at it', () => {
    expect(checkSize(30 * MiB, 25 * MiB)).toMatchObject({ code: 'too_large', details: { sizeBytes: 30 * MiB, maxBytes: 25 * MiB } })
    expect(checkSize(25 * MiB, 25 * MiB)).toBeNull()
  })

  it('takes a raised limit', () => {
    expect(checkSize(30 * MiB, 40 * MiB)).toBeNull()
  })
})

describe('findDuplicate', () => {
  const imported = [
    { id: 'a', path: 'agosto-26/Relatório_2026', sha256: 'sha-1', fileType: 'sales', period: '2026-08', importedAt: '2026-09-10T12:00:00.000Z' },
  ]

  it('names the earlier import with the same content, type and period', () => {
    expect(findDuplicate({ sha256: 'sha-1', fileType: 'sales', period: '2026-08' }, imported)?.id).toBe('a')
  })

  it('is not a duplicate for another period, another type, or different content', () => {
    expect(findDuplicate({ sha256: 'sha-1', fileType: 'sales', period: '2026-07' }, imported)).toBeNull()
    expect(findDuplicate({ sha256: 'sha-1', fileType: 'supply', period: '2026-08' }, imported)).toBeNull()
    expect(findDuplicate({ sha256: 'sha-2', fileType: 'sales', period: '2026-08' }, imported)).toBeNull()
  })

  it('never counts the file itself: an edited file keeps its own earlier import out of the comparison', () => {
    expect(findDuplicate({ sha256: 'sha-1', fileType: 'sales', period: '2026-08', exceptId: 'a' }, imported)).toBeNull()
  })
})

describe('evaluateValidation', () => {
  describe('a complete file', () => {
    it('passes, and states what it was checked against so the result can be reproduced', () => {
      const report = evaluateValidation(input())

      expect(report.outcome).toBe('passed')
      expect(report.blocking).toEqual([])
      expect(report.inconsistencies).toEqual([])
      expect(report).toMatchObject({
        version: 1,
        format: 'network_sales',
        fileType: 'sales',
        period: '2026-08',
        rowCount: 800,
        contentSha256: 'sha-abc',
        dominantMonth: '2026-08',
        periodShare: 1,
        fileCoverage: 1,
        firstDay: '2026-08-01',
        lastDay: '2026-08-31',
        thresholds,
      })
      expect(report.stores.map(s => s.name)).toEqual(['Ascenty - ADM', 'Plena Saude - Taipas'])
    })
  })

  describe('period identity blocks on mismatch', () => {
    it('blocks the same file for July, naming August as the observed month', () => {
      const report = evaluateValidation(input({ period: '2026-07' }))

      expect(report.outcome).toBe('blocked')
      expect(report.blocking).toEqual([
        expect.objectContaining({ code: 'period_mismatch', details: expect.objectContaining({ period: '2026-07', observedMonth: '2026-08', share: 0 }) }),
      ])
    })

    it('blocks a file with 80% of its rows in July and 20% in August for August, naming July', () => {
      const summary = salesSummary({ monthHistogram: { '2026-07': 640, '2026-08': 160 } })
      const report = evaluateValidation(input({ summary }))

      expect(report.outcome).toBe('blocked')
      expect(report.blocking[0]).toMatchObject({ code: 'period_mismatch', details: { observedMonth: '2026-07' } })
      expect(report.periodShare).toBeCloseTo(0.2, 10)
    })

    it('tolerates a few boundary rows: 95% inside the month passes', () => {
      const summary = salesSummary({ monthHistogram: { '2026-08': 760, '2026-09': 40 } })

      expect(codes(evaluateValidation(input({ summary })).blocking)).not.toContain('period_mismatch')
    })

    it('takes the minimum share from the thresholds it is given', () => {
      const summary = salesSummary({ monthHistogram: { '2026-08': 760, '2026-09': 40 } })
      const report = evaluateValidation(input({ summary, thresholds: { ...thresholds, periodMatchMinShare: 0.99 } }))

      expect(codes(report.blocking)).toContain('period_mismatch')
      expect(report.thresholds.periodMatchMinShare).toBe(0.99)
    })

    it('blocks a file with no readable dates: the period could not be verified', () => {
      const summary = salesSummary({ monthHistogram: {}, undatedRows: 800, storeDays: {} })
      const report = evaluateValidation(input({ summary }))

      expect(report.outcome).toBe('blocked')
      expect(codes(report.blocking)).toContain('no_readable_dates')
    })

    it('derives the period from the content when none was given, and says so in the report', () => {
      const report = evaluateValidation(input({ period: null }))

      expect(report.period).toBe('2026-08')
      expect(report.outcome).toBe('passed')
    })

    it('blocks a file that mixes months so evenly that no month can be the period', () => {
      const summary = salesSummary({ monthHistogram: { '2026-07': 400, '2026-08': 400 } })
      const report = evaluateValidation(input({ summary, period: null }))

      expect(codes(report.blocking)).toContain('period_mismatch')
    })
  })

  describe('format decides the type', () => {
    it('blocks an old per-store sales report, saying so', () => {
      const report = evaluateValidation(input({ summary: salesSummary({ format: 'legacy_store_sales' }) }))

      expect(report.outcome).toBe('blocked')
      expect(codes(report.blocking)).toContain('legacy_format')
    })

    it('blocks a file whose structure is not recognised', () => {
      const report = evaluateValidation(input({ summary: salesSummary({ format: 'unknown' }) }))

      expect(codes(report.blocking)).toContain('unknown_format')
    })

    it('blocks a restocking file stated as sales, and the other way round', () => {
      const supply = salesSummary({ format: 'supply', storeDays: {} })

      expect(evaluateValidation(input({ summary: supply, fileType: 'sales' })).blocking[0]).toMatchObject({
        code: 'format_mismatch',
        details: { expected: 'sales', found: 'supply' },
      })
      expect(codes(evaluateValidation(input({ fileType: 'supply' })).blocking)).toContain('format_mismatch')
    })

    it('fills an empty type from the structure', () => {
      expect(evaluateValidation(input({ fileType: null })).fileType).toBe('sales')
    })
  })

  describe('a restocking file has no daily grain', () => {
    const supply = salesSummary({ format: 'supply', monthHistogram: { '2026-07': 24 }, storeDays: {} })

    it('passes on period identity alone, with no coverage figures', () => {
      const report = evaluateValidation(input({ summary: supply, fileType: 'supply', period: '2026-07' }))

      expect(report.outcome).toBe('passed')
      expect(report.stores).toEqual([])
      expect(report.fileCoverage).toBeNull()
      expect(report.firstDay).toBeNull()
    })

    it('is still blocked when its dates are in another month', () => {
      const report = evaluateValidation(input({ summary: supply, fileType: 'supply', period: '2026-08' }))

      expect(report.blocking[0]).toMatchObject({ code: 'period_mismatch', details: { observedMonth: '2026-07' } })
    })
  })

  describe('coverage needs validation, it does not block', () => {
    const wholeFileCut = salesSummary({
      storeDays: { '2026-08': { 'Ascenty - ADM': everyDay(1, 15), 'Plena Saude - Taipas': everyDay(1, 15) } },
    })

    it('flags a file that stops early and lists what to review', () => {
      const report = evaluateValidation(input({ summary: wholeFileCut }))

      expect(report.outcome).toBe('needs_validation')
      expect(report.blocking).toEqual([])
      expect(codes(report.inconsistencies)).toContain('edge_end')
      expect(report.lastDay).toBe('2026-08-15')
    })

    it('flags a single store cut short even though the file as a whole reaches the end of the month', () => {
      const summary = salesSummary({
        storeDays: { '2026-08': { 'Ascenty - ADM': everyDay(), 'Plena Saude - Taipas': everyDay(1, 12) } },
      })
      const report = evaluateValidation(input({ summary }))

      // The network still has rows on the 31st, so no edge inconsistency; the cut store shows as its own coverage.
      expect(report.outcome).toBe('needs_validation')
      expect(codes(report.inconsistencies)).not.toContain('edge_end')
      expect(report.inconsistencies).toContainEqual(
        expect.objectContaining({ code: 'low_store_coverage', details: expect.objectContaining({ store: 'Plena Saude - Taipas' }) }),
      )
    })

    it('flags a store cut so early that no weekday pattern is left, instead of letting it pass', () => {
      const summary = salesSummary({
        storeDays: { '2026-08': { 'Ascenty - ADM': everyDay(), 'Plena Saude - Taipas': everyDay(1, 8) } },
      })
      const report = evaluateValidation(input({ summary }))

      expect(report.outcome).toBe('needs_validation')
      expect(codes(report.inconsistencies)).toContain('store_not_verifiable')
    })

    it('lets a blocking problem win over an inconsistency', () => {
      const report = evaluateValidation(input({ summary: wholeFileCut, period: '2026-07' }))

      expect(report.outcome).toBe('blocked')
    })
  })

  describe('other blocking checks', () => {
    it('blocks an oversized file', () => {
      const report = evaluateValidation(input({ sizeBytes: 30 * MiB }))

      expect(report.outcome).toBe('blocked')
      expect(codes(report.blocking)).toContain('too_large')
    })

    it('blocks a duplicate, naming the earlier import', () => {
      const report = evaluateValidation(
        input({ duplicateOf: { id: 'earlier', path: 'agosto-26/Relatório_2026', importedAt: '2026-09-10T12:00:00.000Z' } }),
      )

      expect(report.outcome).toBe('blocked')
      expect(report.blocking).toEqual([
        expect.objectContaining({ code: 'duplicate', details: { of: 'earlier', path: 'agosto-26/Relatório_2026', importedAt: '2026-09-10T12:00:00.000Z' } }),
      ])
    })

    it('blocks a synthetic file', () => {
      const report = evaluateValidation(input({ isSynthetic: true }))

      expect(report.outcome).toBe('blocked')
      expect(codes(report.blocking)).toContain('synthetic')
    })
  })

  it('keeps aggregates and findings only: no row-level content, card digits or buyer numbers can be in a report', () => {
    const report = evaluateValidation(input())
    const keys = new Set<string>()
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key)
          walk(inner)
        }
      }
    }
    walk(report)

    for (const forbidden of ['buyerNumber', 'buyer_number', 'cardLastDigits', 'card_last_digits', 'coupon', 'rows', 'lines']) {
      if (forbidden === 'rows') continue // `rows` is a per-store COUNT, checked below
      expect(keys.has(forbidden)).toBe(false)
    }
    expect(report.stores.every(store => typeof store.rows === 'number')).toBe(true)
  })
})

describe('blockedWithoutContent', () => {
  it('is a blocked report that names its reason and claims nothing about a content it never read', () => {
    const report = blockedWithoutContent({
      finding: { code: 'synthetic', message: 'synthetic' },
      fileType: 'sales',
      period: '2026-08',
      sizeBytes: 100,
      thresholds,
    })

    expect(report).toMatchObject({ outcome: 'blocked', format: 'unknown', rowCount: 0, contentSha256: '', stores: [], inconsistencies: [] })
    expect(report.blocking).toEqual([{ code: 'synthetic', message: 'synthetic' }])
    expect(report.thresholds).toEqual(thresholds)
  })
})

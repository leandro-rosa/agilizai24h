import { runPair } from '../engine/engine'
import { inputFromReal } from '../engine/engine.testing'
import { REAL_PAIRS } from '../engine/real-pairs.fixture'
import { assertNoLookAhead, HistoryView, latestDatum, monthEnd, originsFor } from './history-view'

const full = () => inputFromReal(REAL_PAIRS.trident_menta_adm, { baseline: 21 })
const ORIGINS = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'].map(day => new Date(`${day}T00:00:00Z`))
const record = { quantity: 21, ofRecord: true }

describe('HistoryView', () => {
  it('hands out only records that ended BEFORE the origin, for every origin', () => {
    for (const origin of ORIGINS) {
      const view = new HistoryView(full())
      const cut = view.at(origin, record)

      expect(cut.visits.length).toBeGreaterThan(0)
      expect(cut.visits.every(visit => visit.endedAt.getTime() < origin.getTime())).toBe(true)
      expect(cut.monthly.every(month => monthEnd(month.month) <= origin.getTime())).toBe(true)
      expect(cut.asOf).toEqual(origin)
      // the spy: the latest date the view ever touched for this origin
      expect((view.latestDateRead as Date).getTime()).toBeLessThan(origin.getTime())
    }
  })

  it('leaves out the month the origin opens: a June origin sees no June data, no June sale, no June removal', () => {
    const june = ORIGINS[2]
    const cut = new HistoryView(full()).at(june, record)

    expect(cut.monthly.map(month => month.month)).not.toContain('2026-06')
    expect(cut.monthly.map(month => month.month)).toContain('2026-05')
    expect(cut.visits.some(visit => visit.endedAt.getTime() >= june.getTime())).toBe(false)
  })

  it('a visit at the very instant of the origin is not before it, and is left out', () => {
    const input = full()
    const origin = input.visits[5].endedAt
    const cut = new HistoryView(input).at(origin, record)

    expect(cut.visits.some(visit => visit.endedAt.getTime() === origin.getTime())).toBe(false)
  })

  it('changing or deleting everything after an origin changes nothing in what the engine returns for it', () => {
    const origin = ORIGINS[2]
    const intact = full()
    const tampered = full()
    tampered.visits = tampered.visits.map(visit => (visit.endedAt.getTime() >= origin.getTime() ? { ...visit, balanceBefore: 9999, balanceAfter: 9999, restocked: 777 } : visit))
    tampered.monthly = tampered.monthly.map(month => (month.month >= '2026-06' ? { ...month, sold: 123456, revenueCents: 99999999, removals: { expired: 5000 } } : month))

    const a = runPair(new HistoryView(intact).at(origin, record))
    const b = runPair(new HistoryView(tampered).at(origin, record))

    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })

  it('never lets the cross-store view or a later reference date through', () => {
    const input = { ...full(), network: { exposedStores: 5, storesWithRemovalPattern: 4, storesWithDamage: 1 } }
    const cut = new HistoryView(input).at(ORIGINS[1], record)

    expect(cut.network).toBeNull()
    expect(cut.asOf.getTime()).toBe(ORIGINS[1].getTime())
  })

  it('carries the baseline of the origin and says when it is the baseline of record', () => {
    expect(new HistoryView(full()).at(ORIGINS[0], { quantity: 14, ofRecord: false })).toMatchObject({ baseline: 14, baselineIsOfRecord: false })
    expect(new HistoryView(full()).at(ORIGINS[0], record)).toMatchObject({ baseline: 21, baselineIsOfRecord: true })
  })
})

describe('assertNoLookAhead', () => {
  it('throws when a later record reaches the input', () => {
    const origin = ORIGINS[1]

    expect(() => assertNoLookAhead(full(), origin)).toThrow(/Look-ahead/)
  })

  it('accepts an input cut at the origin', () => {
    const origin = ORIGINS[1]

    expect(() => assertNoLookAhead(new HistoryView(full()).at(origin, record), origin)).not.toThrow()
    expect((latestDatum(new HistoryView(full()).at(origin, record)) as Date).getTime()).toBeLessThan(origin.getTime())
  })
})

describe('originsFor', () => {
  it('with data from January 9 through August, the origins are April to August', () => {
    const origins = originsFor(new Date('2026-01-09T23:37:05Z'), '2026-08')

    expect(origins.map(origin => origin.toISOString().slice(0, 10))).toEqual(['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'])
  })

  it('needs at least eight weeks of history: Jan 9 + 56 days is Mar 6, so March 1 is too early', () => {
    expect(originsFor(new Date('2026-01-09T00:00:00Z'), '2026-03')).toEqual([])
  })

  it('extends by one origin when a later month becomes the data-through month', () => {
    expect(originsFor(new Date('2026-01-09T00:00:00Z'), '2026-09')).toHaveLength(6)
  })

  it('stops at the data-through month and never goes beyond', () => {
    expect(originsFor(new Date('2026-01-09T00:00:00Z'), '2026-05').map(origin => origin.toISOString().slice(0, 7))).toEqual(['2026-04', '2026-05'])
  })
})

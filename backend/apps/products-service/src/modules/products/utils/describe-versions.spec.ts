import { describeVersions, historyStart } from './describe-versions'
import { COST_RANK, NO_RANK, type Versioned } from './resolve-version'

const v = (id: number, date: string, source = 'other'): Versioned => ({ id, effective_from: new Date(date), source })

describe('describeVersions', () => {
  it('ends each version the day before the next one and leaves the current one open', () => {
    const result = describeVersions([v(1, '2026-08-01'), v(2, '2026-10-10')], NO_RANK)

    expect(result.map(r => [r.version.id, r.valid_to, r.superseded])).toEqual([
      [1, '2026-10-09', false],
      [2, null, false],
    ])
  })

  it('shows the example of the owner: 5,70 until 09/10, then 6,20 until now', () => {
    const [first, second] = describeVersions([v(1, '2026-08-01', 'invoice'), v(2, '2026-10-10', 'invoice')], COST_RANK)

    expect(first.valid_to).toBe('2026-10-09')
    expect(second.valid_to).toBeNull()
  })

  it('marks the version a same-date correction replaced as superseded, and gives it no end', () => {
    const result = describeVersions([v(1, '2026-08-01', 'catalogue_sync'), v(2, '2026-08-01', 'manual'), v(3, '2026-09-01')], COST_RANK)

    expect(result.map(r => [r.version.id, r.superseded, r.valid_to])).toEqual([
      [1, true, null],
      [2, false, '2026-08-31'],
      [3, false, null],
    ])
  })

  it('shows a manual entry as superseded by an invoice of the same date', () => {
    const result = describeVersions([v(1, '2026-10-10', 'invoice'), v(2, '2026-10-10', 'manual')], COST_RANK)

    expect(result.find(r => r.version.id === 2)?.superseded).toBe(true)
    expect(result.find(r => r.version.id === 1)?.superseded).toBe(false)
  })

  it('does not depend on the arrival order and is empty without versions', () => {
    expect(describeVersions([v(2, '2026-10-10'), v(1, '2026-08-01')], NO_RANK).map(r => r.version.id)).toEqual([1, 2])
    expect(describeVersions([], NO_RANK)).toEqual([])
  })
})

describe('historyStart', () => {
  it('is the first effective date, and null when there is no history, so nothing is asserted before it', () => {
    expect(historyStart([v(2, '2026-10-10'), v(1, '2026-08-01')])).toBe('2026-08-01')
    expect(historyStart([])).toBeNull()
  })
})

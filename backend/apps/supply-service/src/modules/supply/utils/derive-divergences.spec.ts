import { deriveDivergences, type VisitLineFact } from './derive-divergences'

const at = (iso: string) => new Date(`${iso}Z`)
let nextVisit = 1

const line = (over: Partial<Omit<VisitLineFact, 'endedAt'>> & { endedAt: string }): VisitLineFact => ({
  storeId: 1,
  sku: 'A',
  visitId: nextVisit++,
  kind: 'inventory',
  period: over.endedAt.slice(0, 7),
  sourceReference: 'Operação 1',
  confirmedCount: null,
  removedTotal: 0,
  removalsByReason: {},
  ...over,
  endedAt: at(over.endedAt),
})

const RANGE = [at('2026-05-01T00:00:00.000'), at('2026-05-11T23:59:59.999')] as const
const run = (lines: VisitLineFact[]) => deriveDivergences(lines, 'other_reason', ...RANGE)

describe('deriveDivergences (fictitious data)', () => {
  it('reports only the requested reason, with the reason own quantity of a mixed line', () => {
    const result = run([
      line({ endedAt: '2026-05-07T10:00:00.000', removedTotal: -9, removalsByReason: { return: 6, other_reason: 3 } }),
      line({ sku: 'B', endedAt: '2026-05-07T10:00:00.000', removedTotal: -4, removalsByReason: { expired: 4 } }),
    ])

    expect(result.divergences).toHaveLength(1)
    expect(result.divergences[0]).toMatchObject({ sku: 'A', quantity: 3 })
  })

  it('takes the latest earlier counted visit of THAT product as the previous conference, per product', () => {
    const result = run([
      line({ sku: 'A', endedAt: '2026-05-04T09:00:00.000', confirmedCount: 10 }),
      line({ sku: 'B', endedAt: '2026-05-02T09:00:00.000', confirmedCount: 7, kind: 'combined' }),
      line({ sku: 'A', endedAt: '2026-05-07T10:00:00.000', removedTotal: -5, removalsByReason: { other_reason: 5 } }),
      line({ sku: 'B', endedAt: '2026-05-07T10:00:00.000', removedTotal: -3, removalsByReason: { other_reason: 3 } }),
    ])

    const [a, b] = result.divergences
    expect(a.previousConferenceAt).toEqual(at('2026-05-04T09:00:00.000'))
    expect(b.previousConferenceAt).toEqual(at('2026-05-02T09:00:00.000'))
    expect(b.previousConferenceKind).toBe('combined')
  })

  it('does not treat a restock without a count as a conference, nor a count of the same visit', () => {
    const result = run([
      line({ endedAt: '2026-05-03T09:00:00.000', confirmedCount: 12 }),
      line({ endedAt: '2026-05-05T09:00:00.000', confirmedCount: null, kind: 'restocking' }),
      line({ endedAt: '2026-05-07T10:00:00.000', confirmedCount: 8, removedTotal: -4, removalsByReason: { other_reason: 4 } }),
    ])

    expect(result.divergences[0].previousConferenceAt).toEqual(at('2026-05-03T09:00:00.000'))
  })

  it('says there is no previous conference rather than inventing one', () => {
    const result = run([line({ endedAt: '2026-05-07T10:00:00.000', removedTotal: -4, removalsByReason: { other_reason: 4 } })])

    expect(result.divergences[0].previousConferenceAt).toBeNull()
  })

  it('shows a previous conference that is before the selected range', () => {
    const result = run([
      line({ endedAt: '2026-03-20T09:00:00.000', confirmedCount: 9 }),
      line({ endedAt: '2026-05-07T10:00:00.000', removedTotal: -2, removalsByReason: { other_reason: 2 } }),
    ])

    expect(result.divergences[0].previousConferenceAt).toEqual(at('2026-03-20T09:00:00.000'))
  })

  it('keeps separate rows for the same product in different intervals', () => {
    const result = run([
      line({ endedAt: '2026-05-02T09:00:00.000', confirmedCount: 9 }),
      line({ endedAt: '2026-05-04T09:00:00.000', removedTotal: -2, removalsByReason: { other_reason: 2 } }),
      line({ endedAt: '2026-05-09T09:00:00.000', removedTotal: -1, removalsByReason: { other_reason: 1 } }),
    ])

    expect(result.divergences.map(d => d.quantity)).toEqual([2, 1])
    expect(result.divergences.map(d => d.identifiedAt.toISOString())).toEqual(['2026-05-04T09:00:00.000Z', '2026-05-09T09:00:00.000Z'])
    expect(result.divergences.every(d => d.previousConferenceAt?.toISOString() === '2026-05-02T09:00:00.000Z')).toBe(true)
  })

  it('filters by the identifying instant, both ends of the range inclusive', () => {
    const result = run([
      line({ sku: 'A', endedAt: '2026-04-30T23:59:59.999', removedTotal: -1, removalsByReason: { other_reason: 1 } }),
      line({ sku: 'B', endedAt: '2026-05-01T00:00:00.000', removedTotal: -1, removalsByReason: { other_reason: 1 } }),
      line({ sku: 'C', endedAt: '2026-05-11T23:59:59.999', removedTotal: -1, removalsByReason: { other_reason: 1 } }),
      line({ sku: 'D', endedAt: '2026-05-12T00:00:00.000', removedTotal: -1, removalsByReason: { other_reason: 1 } }),
    ])

    expect(result.divergences.map(d => d.sku)).toEqual(['B', 'C'])
  })

  it('counts the same operation present in two ingested periods once', () => {
    const result = run([
      line({ endedAt: '2026-05-07T10:00:00.000', period: '2026-05', removedTotal: -2, removalsByReason: { other_reason: 2 } }),
      line({ endedAt: '2026-05-07T10:00:00.000', period: '2026-06', removedTotal: -2, removalsByReason: { other_reason: 2 } }),
    ])

    expect(result.divergences).toHaveLength(1)
    expect(result.divergences[0].quantity).toBe(2)
  })

  it('reports visits whose reasons were never stored as unknown, never as zero loss', () => {
    const result = run([
      line({ endedAt: '2026-05-07T10:00:00.000', removedTotal: -4, removalsByReason: null }),
      line({ sku: 'B', endedAt: '2026-05-07T10:00:00.000', removedTotal: -1, removalsByReason: null }),
      line({ sku: 'C', endedAt: '2026-05-08T10:00:00.000', removedTotal: 0, removalsByReason: null }),
    ])

    expect(result.divergences).toEqual([])
    expect(result.unsplitVisits).toBe(1)
  })

  it('never mixes stores: a count in another store is not a conference here', () => {
    const result = run([
      line({ storeId: 2, endedAt: '2026-05-05T09:00:00.000', confirmedCount: 10 }),
      line({ storeId: 1, endedAt: '2026-05-07T10:00:00.000', removedTotal: -2, removalsByReason: { other_reason: 2 } }),
    ])

    expect(result.divergences[0].previousConferenceAt).toBeNull()
  })

  it('orders by identifying instant, then product', () => {
    const result = run([
      line({ sku: 'Z', endedAt: '2026-05-03T10:00:00.000', removedTotal: -1, removalsByReason: { other_reason: 1 } }),
      line({ sku: 'B', endedAt: '2026-05-07T10:00:00.000', removedTotal: -1, removalsByReason: { other_reason: 1 } }),
      line({ sku: 'A', endedAt: '2026-05-07T10:00:00.000', removedTotal: -1, removalsByReason: { other_reason: 1 } }),
    ])

    expect(result.divergences.map(d => d.sku)).toEqual(['Z', 'A', 'B'])
  })
})

import { COST_RANK, NO_RANK, resolveByProduct, resolveVersionAsOf, type Versioned } from './resolve-version'

const v = (id: number, date: string, source = 'other', extra: Record<string, unknown> = {}): Versioned & Record<string, unknown> => ({ id, effective_from: new Date(date), source, ...extra })
const day = (date: string) => new Date(date)

describe('resolveVersionAsOf', () => {
  it('picks the latest effective date up to the requested one', () => {
    const versions = [v(1, '2026-01-01'), v(2, '2026-06-01')]

    expect(resolveVersionAsOf(versions, day('2026-03-15'))?.id).toBe(1)
    expect(resolveVersionAsOf(versions, day('2026-06-01'))?.id).toBe(2)
    expect(resolveVersionAsOf(versions, day('2026-05-31'))?.id).toBe(1)
  })

  it('is null before the first version and with no versions, never falling back', () => {
    expect(resolveVersionAsOf([v(1, '2026-01-01')], day('2025-12-31'))).toBeNull()
    expect(resolveVersionAsOf([], day('2026-03-15'))).toBeNull()
  })

  it('does not depend on the order the versions arrive in', () => {
    const versions = [v(2, '2026-06-01'), v(1, '2026-01-01'), v(3, '2026-03-01')]

    expect(resolveVersionAsOf(versions, day('2026-04-01'))?.id).toBe(3)
  })

  describe('same effective date', () => {
    it('the latest recorded wins when nothing ranks them apart', () => {
      expect(resolveVersionAsOf([v(1, '2026-08-01'), v(2, '2026-08-01')], day('2026-08-01'), NO_RANK)?.id).toBe(2)
      expect(resolveVersionAsOf([v(2, '2026-08-01'), v(1, '2026-08-01')], day('2026-09-01'), NO_RANK)?.id).toBe(2)
    })

    it('a correction recorded later replaces the earlier one in force, which is kept in the list', () => {
      const versions = [v(1, '2026-08-01', 'catalogue_sync'), v(2, '2026-08-01', 'manual')]

      expect(resolveVersionAsOf(versions, day('2026-08-20'), COST_RANK)?.id).toBe(2)
      expect(versions).toHaveLength(2)
    })

    it('for cost, an invoice beats a manual entry even when the manual one was recorded later', () => {
      const versions = [v(1, '2026-10-10', 'invoice'), v(2, '2026-10-10', 'manual')]

      expect(resolveVersionAsOf(versions, day('2026-10-10'), COST_RANK)?.id).toBe(1)
    })

    it('a later effective date beats an earlier invoice, whatever the source', () => {
      const versions = [v(1, '2026-10-10', 'invoice'), v(2, '2026-10-15', 'manual')]

      expect(resolveVersionAsOf(versions, day('2026-10-20'), COST_RANK)?.id).toBe(2)
      expect(resolveVersionAsOf(versions, day('2026-10-12'), COST_RANK)?.id).toBe(1)
    })

    it('two invoices on the same date: the latest recorded wins', () => {
      expect(resolveVersionAsOf([v(1, '2026-10-10', 'invoice'), v(2, '2026-10-10', 'invoice')], day('2026-10-10'), COST_RANK)?.id).toBe(2)
    })
  })
})

describe('resolveByProduct', () => {
  it('resolves each product on its own', () => {
    const versions = [v(1, '2026-01-01', 'other', { product_id: 10 }), v(2, '2026-06-01', 'other', { product_id: 10 }), v(3, '2026-02-01', 'other', { product_id: 11 })] as unknown as (Versioned & { product_id: number })[]
    const result = resolveByProduct(versions, day('2026-03-01'))

    expect(result.get(10)?.id).toBe(1)
    expect(result.get(11)?.id).toBe(3)
  })

  it('leaves out a product with no version yet, so the caller reports it instead of reading zero', () => {
    const versions = [v(1, '2026-06-01', 'other', { product_id: 10 })] as unknown as (Versioned & { product_id: number })[]

    expect(resolveByProduct(versions, day('2026-03-01')).has(10)).toBe(false)
  })
})

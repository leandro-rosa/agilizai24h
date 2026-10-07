import { backoffSeconds, costSourceRef, dueForRetry, sendsCost, variationBps } from './cost-sync'

describe('cost-sync rules', () => {
  it('a bonus never creates a cost; paid and on_sale do', () => {
    expect(sendsCost('bonus')).toBe(false)
    expect(sendsCost('paid')).toBe(true)
    expect(sendsCost('on_sale')).toBe(true)
  })

  it('variation is in basis points of the previous cost, signed, and null without a previous cost', () => {
    expect(variationBps(570, 620)).toBe(877)
    expect(variationBps(620, 570)).toBe(-806)
    expect(variationBps(null, 620)).toBeNull()
    expect(variationBps(0, 620)).toBeNull()
  })

  it('the idempotency key changes with the cost or the day, not with a resend', () => {
    expect(costSourceRef(7, 620, '2026-10-10')).toBe(costSourceRef(7, 620, '2026-10-10'))
    expect(costSourceRef(7, 620, '2026-10-10')).not.toBe(costSourceRef(7, 650, '2026-10-10'))
    expect(costSourceRef(7, 620, '2026-10-10')).not.toBe(costSourceRef(7, 620, '2026-10-11'))
  })

  it('backs off 1, 2, 4 minutes and caps at 30', () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([60, 120, 240, 480])
    expect(backoffSeconds(20)).toBe(1800)
  })

  it('an item is due again only after its backoff', () => {
    const now = new Date('2026-10-10T12:00:00Z')
    expect(dueForRetry(0, null, now)).toBe(true)
    expect(dueForRetry(1, new Date('2026-10-10T11:59:30Z'), now)).toBe(false)
    expect(dueForRetry(1, new Date('2026-10-10T11:58:30Z'), now)).toBe(true)
  })
})

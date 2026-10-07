import { buildHistory } from './history'

const point = (month: string, costCents: number | null, priceCents: number | null) => ({ month, costCents, priceCents })

describe('buildHistory', () => {
  it('computes the product margin and markup per month', () => {
    const [row] = buildHistory([point('2026-07', 300, 600)])

    expect(row.margin).toBeCloseTo(0.5, 8)
    expect(row.markup).toBeCloseTo(2, 8)
  })

  it('flags a cost rise, a price change, a margin fall and an improvement against the previous month', () => {
    const rows = buildHistory([point('2026-06', 280, 590), point('2026-07', 309, 590), point('2026-08', 309, 650)])

    expect(rows[1]).toMatchObject({ costRose: true, priceChanged: false, marginFell: true, marginImproved: false })
    expect(rows[2]).toMatchObject({ costRose: false, priceChanged: true, marginFell: false, marginImproved: true })
  })

  it('leaves the first month unflagged — there is nothing to compare', () => {
    expect(buildHistory([point('2026-06', 280, 590)])[0]).toMatchObject({ costRose: false, priceChanged: false, marginFell: false, marginImproved: false })
  })

  it('empties margin and markup for a month with no cost or no price, never zero', () => {
    const rows = buildHistory([point('2026-06', 280, 590), point('2026-07', null, 590), point('2026-08', 300, null)])

    expect(rows[1]).toMatchObject({ costCents: null, margin: null, markup: null })
    expect(rows[2]).toMatchObject({ priceCents: null, margin: null, markup: null })
    expect(rows[1].costRose).toBe(false)
    expect(rows[2].marginFell).toBe(false)
  })

  it('does not call a hundredth of a point a fall', () => {
    const rows = buildHistory([point('2026-06', 300, 600), point('2026-07', 300, 600)])

    expect(rows[1]).toMatchObject({ marginFell: false, marginImproved: false })
  })
})

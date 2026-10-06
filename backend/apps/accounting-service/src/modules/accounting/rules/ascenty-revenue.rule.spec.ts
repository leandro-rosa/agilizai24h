import { splitAscentyRevenue } from './ascenty-revenue.rule'

const cfg = { mensalidade_unit_cents: 70000, service_unit_cents: 6800, coffee_unit_cents: 2000 }
const reais = (...values: number[]) => values.map(v => v * 100)

describe('splitAscentyRevenue', () => {
  it('reproduces the operator-confirmed totals for set/2026', () => {
    const september = reais(
      ...Array(10).fill(700), 1400, 1400,
      1224, 1360, 1360, 1428, 1496, 1564, 2040, 2176, 2516, 3604, 4080,
    )

    expect(splitAscentyRevenue(september, cfg)).toEqual({
      mensalidade_cents: 980000,
      coffee_cents: 672000,
      frutas_cents: 1612800,
      unclassified_cents: 0,
    })
  })

  it('leaves entries that fit no rule unclassified instead of guessing', () => {
    expect(splitAscentyRevenue(reais(300, 1200, 700), cfg)).toEqual({
      mensalidade_cents: 70000,
      coffee_cents: 0,
      frutas_cents: 0,
      unclassified_cents: 150000,
    })
  })

  it('returns zeros for no entries', () => {
    expect(splitAscentyRevenue([], cfg)).toEqual({ mensalidade_cents: 0, coffee_cents: 0, frutas_cents: 0, unclassified_cents: 0 })
  })
})

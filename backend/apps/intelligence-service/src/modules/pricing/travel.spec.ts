import { travelEstimate, TRAVEL_UNIT } from './travel'

describe('travelEstimate — the average cost per restocking', () => {
  it('is the month spend over the restocking visits of the same month, and shows the figures it used', () => {
    const result = travelEstimate({ scope: 'rede', months: [{ period: '2026-09', costCents: 600_000, visits: 100 }] })

    expect(result.perVisitCents).toBe(6000)
    expect(result.months[0]).toMatchObject({ period: '2026-09', costCents: 600_000, visits: 100, perVisitCents: 6000, status: 'used' })
    expect(result.usedCostCents).toBe(600_000)
    expect(result.usedVisits).toBe(100)
    expect(result.unit).toBe(TRAVEL_UNIT)
  })

  it('pools the months (sum of spend over sum of visits), never an average of monthly averages', () => {
    // Jul 100.000 / 10 = 10.000 per visit; Aug 300.000 / 100 = 3.000 per visit. The pooled average is 400.000 / 110, not (10.000 + 3.000) / 2.
    const result = travelEstimate({ scope: 'rede', months: [{ period: '2026-07', costCents: 100_000, visits: 10 }, { period: '2026-08', costCents: 300_000, visits: 100 }] })

    expect(result.perVisitCents).toBeCloseTo(400_000 / 110, 8)
    expect(result.perVisitCents).not.toBeCloseTo(6500, 0)
  })

  it('does not divide by zero and does not assume a zero cost: such months are excluded and say why', () => {
    const result = travelEstimate({
      scope: 'rede',
      months: [{ period: '2026-07', costCents: 100_000, visits: 0 }, { period: '2026-08', costCents: 100_000, visits: null }, { period: '2026-09', costCents: null, visits: 50 }],
    })

    expect(result.perVisitCents).toBeNull()
    expect(result.usedVisits).toBe(0)
    expect(result.excludedMonths).toEqual([
      { period: '2026-07', reason: 'zero abastecimentos no mês: não há divisão' },
      { period: '2026-08', reason: 'sem registro de abastecimentos no mês (desconhecido, não zero)' },
      { period: '2026-09', reason: 'sem DRE com o gasto de deslocamento' },
    ])
    expect(result.months.every(month => month.perVisitCents === null)).toBe(true)
  })

  it('a month that cannot be used does not drag the others: numerator and denominator cover the same months', () => {
    // August has spend but no visit record: its spend must NOT sit in the numerator while its visits are missing from the denominator.
    const result = travelEstimate({ scope: 'rede', months: [{ period: '2026-08', costCents: 900_000, visits: null }, { period: '2026-09', costCents: 600_000, visits: 100 }] })

    expect(result.usedCostCents).toBe(600_000)
    expect(result.perVisitCents).toBe(6000)
  })

  it('apportions to a store only from its real visit count, labelled an estimate, and the shares add up to the pooled spend', () => {
    const result = travelEstimate({ scope: 'rede', months: [{ period: '2026-09', costCents: 600_000, visits: 100 }], visitsByStore: new Map([[1, 60], [2, 40], [3, 0]]) })

    expect(result.stores).toEqual([{ storeId: 1, visits: 60, estimatedCents: 360_000 }, { storeId: 2, visits: 40, estimatedCents: 240_000 }])
    expect(result.stores.reduce((sum, store) => sum + store.estimatedCents, 0)).toBeCloseTo(result.usedCostCents, 6)
    expect(result.limitations.join(' ')).toContain('rateio estimado')
  })

  it('gives no store figure without per-store counts or without an average', () => {
    expect(travelEstimate({ scope: 'rede', months: [{ period: '2026-09', costCents: 600_000, visits: 100 }] }).stores).toEqual([])
    expect(travelEstimate({ scope: 'rede', months: [{ period: '2026-09', costCents: 1, visits: 0 }], visitsByStore: new Map([[1, 5]]) }).stores).toEqual([])
  })

  it('always says it is an average, that the account does not separate the activity, and so is not exclusive to the minimarket', () => {
    const text = travelEstimate({ scope: 'rede', months: [{ period: '2026-09', costCents: 600_000, visits: 100 }] }).limitations.join(' ')

    expect(text).toContain('Custo médio estimado por abastecimento')
    expect(text).toContain('não o custo real de uma rota ou de uma visita')
    expect(text).toContain('frutas, coffee break')
    expect(text).toContain('não é exclusiva do minimercado')
  })
})

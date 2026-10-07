import { distributeTransactionCost, perUnitTransactionCost, type Ticket } from './transaction-cost'

const sum = (values: Iterable<number>) => [...values].reduce((total, value) => total + value, 0)

describe('distributeTransactionCost — ticket, line and unit are three different things', () => {
  it('shares a ticket among its units: a line of three units weighs three, not one', () => {
    // One ticket costing R$ 1,00: a line of 3 units of A and a line of 1 unit of B.
    const result = distributeTransactionCost(100, [{ lines: [{ sku: 'A', quantity: 3 }, { sku: 'B', quantity: 1 }] }])

    expect(result.bySku.get('A')).toBe(75)
    expect(result.bySku.get('B')).toBe(25)
    expect(result.distributedCents).toBe(100)
    // The cost per unit is the same for every unit of the ticket (25 cents), whatever the line.
    expect((result.bySku.get('A') as number) / (result.unitsBySku.get('A') as number)).toBe(25)
    expect((result.bySku.get('B') as number) / (result.unitsBySku.get('B') as number)).toBe(25)
  })

  it('a unit bought alone carries the whole ticket; a unit in a big basket carries a fraction', () => {
    const tickets: Ticket[] = [
      { lines: [{ sku: 'A', quantity: 1 }] },
      { lines: [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 3 }] },
    ]
    const result = distributeTransactionCost(200, tickets) // 100 per ticket

    expect(result.bySku.get('A')).toBe(100 + 25)
    expect(result.bySku.get('B')).toBe(75)
    expect(result.unitsBySku.get('A')).toBe(2) // A pays 62,5 per unit; B pays 25
    expect(result.distributedCents).toBe(200)
  })

  it('reproduces the total exactly, remainders included, and is deterministic', () => {
    const tickets: Ticket[] = [
      { lines: [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 1 }, { sku: 'C', quantity: 1 }] },
      { lines: [{ sku: 'A', quantity: 2 }] },
      { lines: [{ sku: 'C', quantity: 5 }, { sku: 'B', quantity: 2 }] },
    ]
    for (const total of [0, 1, 7, 100, 101, 9_999, 123_457]) {
      const first = distributeTransactionCost(total, tickets)
      const again = distributeTransactionCost(total, tickets)

      expect(first.distributedCents).toBe(total)
      expect(sum(first.bySku.values())).toBe(total)
      expect([...first.bySku]).toEqual([...again.bySku])
      expect([...first.bySku.values()].every(Number.isInteger)).toBe(true)
    }
  })

  it('splits 100 cents over 3 tickets as 34/33/33, never losing or inventing a cent', () => {
    const tickets: Ticket[] = [{ lines: [{ sku: 'A', quantity: 1 }] }, { lines: [{ sku: 'B', quantity: 1 }] }, { lines: [{ sku: 'C', quantity: 1 }] }]
    const result = distributeTransactionCost(100, tickets)

    expect([result.bySku.get('A'), result.bySku.get('B'), result.bySku.get('C')]).toEqual([34, 33, 33])
  })

  it('ignores lines without units and tickets with none, and distributes nothing when there is nothing to distribute over', () => {
    const result = distributeTransactionCost(100, [{ lines: [{ sku: 'A', quantity: 0 }] }, { lines: [{ sku: 'B', quantity: 2 }] }])

    expect(result.bySku.get('B')).toBe(100)
    expect(result.bySku.has('A')).toBe(false)
    expect(distributeTransactionCost(100, []).distributedCents).toBe(0)
  })

  it('refuses a total that is not a whole number of centavos', () => {
    expect(() => distributeTransactionCost(10.5, [])).toThrow(RangeError)
    expect(() => distributeTransactionCost(-1, [])).toThrow(RangeError)
  })
})

describe('perUnitTransactionCost — the aggregate estimate, tied to the exact distribution', () => {
  it('equals the exact distribution when every ticket is one line, so the units of a line share one ticket', () => {
    // 4 tickets of one line each: A,A,A sold 1,1,2 units; B once with 4 units. Total R$ 4,00 = R$ 1,00 per ticket.
    const tickets: Ticket[] = [
      { lines: [{ sku: 'A', quantity: 1 }] },
      { lines: [{ sku: 'A', quantity: 1 }] },
      { lines: [{ sku: 'A', quantity: 2 }] },
      { lines: [{ sku: 'B', quantity: 4 }] },
    ]
    const exact = distributeTransactionCost(400, tickets)
    const units = 8
    const estimate = perUnitTransactionCost(400, 4, 4 / units, 'rede')!

    // The network average per unit is the aggregate figure: 400 cents over 8 units.
    expect(estimate.perUnitCents * units).toBeCloseTo(400, 8)
    expect(sum(exact.bySku.values())).toBe(400)
    // A product's own ratio (A: 3 lines over 4 units) gives its exact per-unit cost: 3 tickets x 100 / 4 units = 75.
    expect(perUnitTransactionCost(400, 4, 3 / 4, 'produto')!.perUnitCents).toBeCloseTo((exact.bySku.get('A') as number) / (exact.unitsBySku.get('A') as number), 8)
    expect(perUnitTransactionCost(400, 4, 1 / 4, 'produto')!.perUnitCents).toBeCloseTo((exact.bySku.get('B') as number) / (exact.unitsBySku.get('B') as number), 8)
  })

  it('is not the total divided by the number of lines read as a cost per unit', () => {
    // 2 lines, 6 units (a line of 5 and a line of 1), R$ 1,20: per line 60, but per unit it is 60 / (6/2) = 20.
    const estimate = perUnitTransactionCost(120, 2, 2 / 6, 'rede')!

    expect(estimate.perUnitCents).toBeCloseTo(20, 8)
    expect(estimate.perUnitCents).not.toBeCloseTo(120 / 2, 8)
  })

  it('states its hypothesis in words and is zero with no transaction cost', () => {
    expect(perUnitTransactionCost(120, 2, 0.5, 'rede')!.assumption).toMatch(/Cada linha de venda conta como um ticket.*média rede de 0,50 linha por unidade/)
    expect(perUnitTransactionCost(0, 0, 0, 'rede')).toEqual({ perUnitCents: 0, assumption: 'Sem custo por transação no período' })
  })

  it('has no number when there is a cost but no tickets or units to base it on', () => {
    expect(perUnitTransactionCost(120, 0, 0.5, 'rede')).toBeNull()
    expect(perUnitTransactionCost(120, 2, 0, 'rede')).toBeNull()
  })
})

import { distributeTicketCosts, distributeTransactionCost, perUnitFromAggregates, countTickets, ticketsFromLines, type Ticket } from './transaction-cost'

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

describe('distributeTicketCosts — a fee that each ticket carries on its own (the fixed payment fee)', () => {
  it('a line of three units: the fee of its ticket is shared by the units, not charged to the line as if it were one', () => {
    // One Ticket-voucher sale of R$ 0,89 with a line of 3 units of A.
    const result = distributeTicketCosts([{ costCents: 89, lines: [{ sku: 'A', quantity: 3 }] }])

    expect(result.bySku.get('A')).toBe(89)
    expect((result.bySku.get('A') as number) / (result.unitsBySku.get('A') as number)).toBeCloseTo(29.67, 2)
    expect(result.distributedCents).toBe(89)
  })

  it('a ticket with several products shares its one fee by quantity, and a Pix ticket with no fee costs nothing', () => {
    const result = distributeTicketCosts([
      { costCents: 89, lines: [{ sku: 'A', quantity: 2 }, { sku: 'B', quantity: 1 }, { sku: 'C', quantity: 1 }] },
      { costCents: 0, lines: [{ sku: 'A', quantity: 5 }] },
    ])

    // 89 over 4 units: A 2/4, B 1/4, C 1/4 -> 44,5 / 22,25 / 22,25 -> whole cents by largest remainder.
    expect([result.bySku.get('A'), result.bySku.get('B'), result.bySku.get('C')]).toEqual([45, 22, 22])
    expect(result.distributedCents).toBe(89)
  })

  it('rounding remainders never lose or invent a cent: the distributed amounts reproduce the known total of the fees', () => {
    const tickets: Ticket[] = [
      { costCents: 89, lines: [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 1 }, { sku: 'C', quantity: 1 }] },
      { costCents: 89, lines: [{ sku: 'B', quantity: 7 }] },
      { costCents: 50, lines: [{ sku: 'A', quantity: 3 }, { sku: 'C', quantity: 2 }] },
      { costCents: 1, lines: [{ sku: 'D', quantity: 3 }] },
    ]
    const total = tickets.reduce((sum, ticket) => sum + (ticket.costCents as number), 0)
    const result = distributeTicketCosts(tickets)

    expect(result.distributedCents).toBe(total)
    expect([...result.bySku.values()].reduce((a, b) => a + b, 0)).toBe(total)
    expect([...result.bySku.values()].every(Number.isInteger)).toBe(true)
    expect(result.unplacedCents).toBe(0)
    // Deterministic.
    expect([...distributeTicketCosts(tickets).bySku]).toEqual([...result.bySku])
  })

  it('a ticket with no unit cannot carry its fee: it is reported as unplaced, never dropped', () => {
    const result = distributeTicketCosts([{ costCents: 89, lines: [{ sku: 'A', quantity: 0 }] }, { costCents: 10, lines: [{ sku: 'B', quantity: 2 }] }])

    expect(result.unplacedCents).toBe(89)
    expect(result.distributedCents).toBe(10)
  })

  it('refuses a fee that is not a whole number of centavos', () => {
    expect(() => distributeTicketCosts([{ costCents: 0.5, lines: [{ sku: 'A', quantity: 1 }] }])).toThrow(RangeError)
  })
})

describe('ticketsFromLines — no identifier, no invented grouping', () => {
  const line = (sku: string, quantity: number, ticketId: string | null) => ({ sku, quantity, ticketId })

  it('groups lines by their purchase identifier into one ticket', () => {
    const result = ticketsFromLines([line('A', 2, 'T1'), line('B', 1, 'T1'), line('A', 1, 'T2')])

    expect(result.tickets).toHaveLength(2)
    expect(result.tickets[0].lines).toEqual([{ sku: 'A', quantity: 2 }, { sku: 'B', quantity: 1 }])
    expect(result.basis).toBe('identified')
    expect(result.linesWithoutTicketId).toBe(0)
  })

  it('lines without an identifier stand alone and are counted as an approximation, never merged by guess', () => {
    const result = ticketsFromLines([line('A', 1, null), line('B', 1, null), line('A', 3, null)])

    expect(result.tickets).toHaveLength(3)
    expect(result.linesWithoutTicketId).toBe(3)
    expect(result.basis).toBe('partial')
  })

  it('a mix of both keeps the identified groups and flags the rest', () => {
    const result = ticketsFromLines([line('A', 1, 'T1'), line('B', 1, 'T1'), line('C', 2, null)])

    expect(result.tickets).toHaveLength(2)
    expect(result.basis).toBe('partial')
    expect(result.linesWithoutTicketId).toBe(1)
  })
})

describe('countTickets — observed, estimated from the identified ones, or unknown (never one per line)', () => {
  const count = (lines: number, reportedTickets: number, linesWithoutTicketId: number, minIdentifiedShare = 0.5) => countTickets({ lines, reportedTickets, linesWithoutTicketId, minIdentifiedShare })

  it('every line identified: the tickets are the observed ones', () => {
    expect(count(100, 80, 0)).toEqual({ tickets: 80, basis: 'identified', linesWithoutTicketId: 0, estimatedTickets: 0 })
  })

  it('some lines unidentified: they are estimated with the tickets-per-line ratio of the identified ones, not counted one each', () => {
    // 100 lines; 80 identified forming 64 tickets (0,8 per line); 20 unidentified reported once each (so 84 reported). Estimate: 64 + 20 x 0,8 = 80.
    const result = count(100, 84, 20)

    expect(result.basis).toBe('estimated')
    expect(result.tickets).toBeCloseTo(80, 8)
    expect(result.estimatedTickets).toBeCloseTo(16, 8)
    expect(result.tickets).not.toBe(84)
  })

  it('too few identified lines: the tickets are unknown and nothing is supposed', () => {
    expect(count(100, 95, 90)).toEqual({ tickets: null, basis: 'unknown', linesWithoutTicketId: 90, estimatedTickets: 0 })
    // None identified: the old behaviour (a ticket per line) is exactly what must NOT happen.
    expect(count(100, 100, 100).tickets).toBeNull()
  })

  it('the minimum identified share is a parameter, not a constant', () => {
    expect(count(100, 95, 90, 0.05).basis).toBe('estimated')
    expect(count(100, 95, 90, 0.5).basis).toBe('unknown')
  })

  it('no lines is zero tickets, observed', () => {
    expect(count(0, 0, 0)).toMatchObject({ tickets: 0, basis: 'identified' })
  })
})

describe('perUnitFromAggregates — the aggregate estimate, tied to the exact distribution', () => {
  it('equals the exact distribution averaged over the units', () => {
    const tickets: Ticket[] = [
      { lines: [{ sku: 'A', quantity: 1 }] },
      { lines: [{ sku: 'A', quantity: 1 }] },
      { lines: [{ sku: 'A', quantity: 2 }] },
      { lines: [{ sku: 'B', quantity: 4 }] },
    ]
    const exact = distributeTransactionCost(400, tickets)
    const estimate = perUnitFromAggregates({ totalCents: 400, units: 8, lines: 4, tickets: countTickets({ lines: 4, reportedTickets: 4, linesWithoutTicketId: 0, minIdentifiedShare: 0.5 }), scope: 'rede' })!

    expect(estimate.perUnitCents * 8).toBeCloseTo(sum(exact.bySku.values()), 8)
    expect(estimate.perUnitCents).toBe(50)
  })

  it('is not the total divided by the number of lines read as a cost per unit', () => {
    // 2 lines, 6 units (a line of 5 and a line of 1), R$ 1,20: 60 per line, but 20 per unit.
    const estimate = perUnitFromAggregates({ totalCents: 120, units: 6, lines: 2, tickets: countTickets({ lines: 2, reportedTickets: 2, linesWithoutTicketId: 0, minIdentifiedShare: 0.5 }), scope: 'rede' })!

    expect(estimate.perUnitCents).toBeCloseTo(20, 8)
    expect(estimate.perUnitCents).not.toBeCloseTo(120 / 2, 8)
  })

  it('says whether the tickets are observed, estimated or unknown, in words', () => {
    const tickets = (reported: number, without: number) => countTickets({ lines: 4, reportedTickets: reported, linesWithoutTicketId: without, minIdentifiedShare: 0.5 })
    const observed = perUnitFromAggregates({ totalCents: 120, units: 6, lines: 4, tickets: tickets(3, 0), scope: 'rede' })!
    const estimated = perUnitFromAggregates({ totalCents: 120, units: 6, lines: 4, tickets: tickets(3, 1), scope: 'rede' })!
    const unknown = perUnitFromAggregates({ totalCents: 120, units: 6, lines: 4, tickets: tickets(4, 4), scope: 'rede' })!

    expect(observed).toMatchObject({ basis: 'identified', approximated: false })
    expect(observed.assumption).toContain('Tickets identificados pelo código da compra')
    expect(estimated).toMatchObject({ basis: 'estimated', approximated: true })
    expect(estimated.assumption).toContain('1 de 4 linhas (25,0%) sem identificador de compra tiveram os tickets ESTIMADOS')
    expect(unknown).toMatchObject({ basis: 'unknown', approximated: true })
    expect(unknown.assumption).toContain('os tickets são desconhecidos e não foram supostos')
  })

  it('is zero with no transaction cost, and has no number when there is a cost but no unit to carry it', () => {
    expect(perUnitFromAggregates({ totalCents: 0, units: 0, lines: 0, tickets: countTickets({ lines: 0, reportedTickets: 0, linesWithoutTicketId: 0, minIdentifiedShare: 0.5 }), scope: 'rede' })).toMatchObject({ perUnitCents: 0, assumption: 'Sem custo por transação no período' })
    expect(perUnitFromAggregates({ totalCents: 120, units: 0, lines: 2, tickets: countTickets({ lines: 2, reportedTickets: 2, linesWithoutTicketId: 0, minIdentifiedShare: 0.5 }), scope: 'rede' })).toBeNull()
  })
})

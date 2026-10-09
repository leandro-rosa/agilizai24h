/**
 * A cost charged per transaction (per ticket) reaches the price of a product through the units it sold — and a ticket, a sale line and a unit are three
 * different things. A ticket is one purchase; a line is one product in it, with a quantity; a unit is one item. The cost of a ticket is shared among the
 * units of THAT ticket, so a unit bought alone carries the whole ticket and a unit in a basket of ten carries a tenth. Dividing the total by the number of
 * lines and calling the result a cost per unit would charge a line of three units as if it were one.
 */
export interface TicketLine {
  sku: string
  /** Units of the product in this line; the weight of the line inside its ticket. */
  quantity: number
}

export interface Ticket {
  lines: TicketLine[]
  /** What this ticket costs, in whole centavos, when it differs from one ticket to the next (a fixed payment fee depends on the method). */
  costCents?: number
}

/** A receipt line as the sales detail has it; `ticketId` identifies the purchase (coupon, else the transaction code, else the acquirer's code), absent when the report carried none. */
export interface ReceiptLine {
  sku: string
  quantity: number
  ticketId: string | null
}

/** `identified`: every ticket observed. `estimated`: the lines without an identifier were estimated from the ones that have it. `unknown`: too few identified lines to estimate. */
export type TicketBasis = 'identified' | 'estimated' | 'unknown'

export interface TicketCount {
  /** Tickets used: the observed ones plus the estimate for the lines without an identifier; `null` when it cannot be said. */
  tickets: number | null
  basis: TicketBasis
  /** Lines with no purchase identifier, whose grouping is unknown. */
  linesWithoutTicketId: number
  /** The part of `tickets` that is an estimate (0 when `identified`). */
  estimatedTickets: number
}

/**
 * Counts the tickets of a set of receipt lines from what the sales service reports: the lines, the tickets as it counts them (distinct identifiers plus each
 * unidentified line once) and how many lines carry no identifier. Never "one ticket per line": with every line identified the count is observed; with some
 * unidentified, they are ESTIMATED with the tickets-per-line ratio of the identified ones (a real ratio, measured on the same sales); with too few identified
 * (below `minIdentifiedShare`), or none, the tickets are unknown and nothing is invented.
 */
export function countTickets(input: { lines: number; reportedTickets: number; linesWithoutTicketId: number; minIdentifiedShare: number }): TicketCount {
  const without = Math.min(Math.max(input.linesWithoutTicketId, 0), input.lines)
  if (input.lines <= 0) return { tickets: 0, basis: 'identified', linesWithoutTicketId: 0, estimatedTickets: 0 }
  if (without === 0) return { tickets: input.reportedTickets, basis: 'identified', linesWithoutTicketId: 0, estimatedTickets: 0 }

  const identifiedLines = input.lines - without
  const identifiedTickets = input.reportedTickets - without
  if (identifiedLines <= 0 || identifiedLines / input.lines < input.minIdentifiedShare) return { tickets: null, basis: 'unknown', linesWithoutTicketId: without, estimatedTickets: 0 }

  const estimated = without * (identifiedTickets / identifiedLines)

  return { tickets: identifiedTickets + estimated, basis: 'estimated', linesWithoutTicketId: without, estimatedTickets: estimated }
}

export interface TicketsFromLines {
  tickets: Ticket[]
  /** Lines that carried no identifier and stand alone: their grouping is unknown, so they are an approximation, never an observed grouping. */
  linesWithoutTicketId: number
  basis: 'identified' | 'partial'
}

/**
 * Groups receipt lines into tickets by their identifier. A line without one is NEVER merged with another: nothing says it belongs to the same
 * purchase, so it stands alone and is counted in `linesWithoutTicketId` so the approximation stays visible.
 */
export function ticketsFromLines(lines: ReceiptLine[]): TicketsFromLines {
  const byId = new Map<string, Ticket>()
  const tickets: Ticket[] = []
  let linesWithoutTicketId = 0

  for (const line of lines) {
    if (line.ticketId === null || line.ticketId === '') {
      linesWithoutTicketId += 1
      tickets.push({ lines: [{ sku: line.sku, quantity: line.quantity }] })
      continue
    }
    const ticket = byId.get(line.ticketId) ?? { lines: [] }
    ticket.lines.push({ sku: line.sku, quantity: line.quantity })
    if (!byId.has(line.ticketId)) {
      byId.set(line.ticketId, ticket)
      tickets.push(ticket)
    }
  }

  return { tickets, linesWithoutTicketId, basis: linesWithoutTicketId === 0 ? 'identified' : 'partial' }
}

/** Largest-remainder split of `total` whole cents by `weights`; ties go to the lower index, so the result is deterministic and always adds up to `total`. */
function split(total: number, weights: number[]): number[] {
  const weight = weights.reduce((sum, value) => sum + value, 0)
  if (weights.length === 0 || weight <= 0) return weights.map(() => 0)

  const exact = weights.map(value => (total * value) / weight)
  const floors = exact.map(Math.floor)
  let rest = total - floors.reduce((sum, value) => sum + value, 0)
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index)

  for (const { index } of order) {
    if (rest <= 0) break
    floors[index] += 1
    rest -= 1
  }

  return floors
}

export interface Distribution {
  /** Cents of the total that fall on each product, summed over every line of every ticket. */
  bySku: Map<string, number>
  /** Units sold per product, for the cost per unit. */
  unitsBySku: Map<string, number>
  /** What was distributed; always equals the total handed in when there is at least one unit. */
  distributedCents: number
}

/**
 * Distributes the total cost of the transactions: first equally over the tickets, then inside each ticket by quantity (a line of three units weighs three).
 * Whole cents, remainders by largest remainder, so the distributed amounts reproduce the total exactly.
 */
export function distributeTransactionCost(totalCents: number, tickets: Ticket[]): Distribution {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new RangeError('The total cost must be a whole number of centavos, zero or more')
  const usable = tickets.filter(ticket => ticket.lines.some(line => line.quantity > 0))
  if (usable.length === 0) return { bySku: new Map(), unitsBySku: new Map(), distributedCents: 0 }

  return distributeAcross(split(totalCents, usable.map(() => 1)), usable)
}

/**
 * Distributes a cost that each ticket carries on its own (a fixed payment fee: R$ 0,89 on a Ticket-voucher sale, none on a Pix one) among the units of
 * THAT ticket by quantity. The distributed amounts add up to the sum of the ticket costs, in whole centavos; a ticket with no units cannot carry its
 * cost and is reported in `unplacedCents` instead of vanishing.
 */
export function distributeTicketCosts(tickets: Ticket[]): Distribution & { unplacedCents: number } {
  let unplaced = 0
  const usable: Ticket[] = []
  for (const ticket of tickets) {
    const cost = ticket.costCents ?? 0
    if (!Number.isInteger(cost) || cost < 0) throw new RangeError('Each ticket cost must be a whole number of centavos, zero or more')
    if (ticket.lines.some(line => line.quantity > 0)) usable.push(ticket)
    else unplaced += cost
  }
  const result = distributeAcross(usable.map(ticket => ticket.costCents ?? 0), usable)

  return { ...result, unplacedCents: unplaced }
}

function distributeAcross(perTicket: number[], usable: Ticket[]): Distribution {
  const bySku = new Map<string, number>()
  const unitsBySku = new Map<string, number>()
  usable.forEach((ticket, index) => {
    const lines = ticket.lines.filter(line => line.quantity > 0)
    const shares = split(perTicket[index], lines.map(line => line.quantity))
    lines.forEach((line, position) => {
      bySku.set(line.sku, (bySku.get(line.sku) ?? 0) + shares[position])
      unitsBySku.set(line.sku, (unitsBySku.get(line.sku) ?? 0) + line.quantity)
    })
  })

  return { bySku, unitsBySku, distributedCents: [...bySku.values()].reduce((sum, value) => sum + value, 0) }
}

export interface PerUnitEstimate {
  /** Centavos per sold unit, fractional (a price is solved from it, so it is not rounded here). */
  perUnitCents: number
  basis: TicketBasis
  /** True when the grouping into tickets is not fully observed (some lines have no identifier, or the tickets are unknown). */
  approximated: boolean
  /** The hypothesis the number rests on, in words, so it is never read as measured. */
  assumption: string
}

const ratio = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1).replace('.', ',')}%` : '0,0%')

/**
 * The cost per sold unit when only aggregates are known — the total of the ticket costs (from the books) and the units sold. It is the average over every
 * unit sold in the scope, which is what `distributeTicketCosts` gives on average (a unit bought alone pays its whole ticket and a unit in a big basket a
 * fraction, so one product can pay more or less than this average). The ticket count does not change the figure, because the total comes from the books;
 * it only says how firmly the tickets are known. `null` when there is a cost and no units to carry it.
 */
export function perUnitFromAggregates(input: { totalCents: number; units: number; lines: number; tickets: TicketCount; scope: string }): PerUnitEstimate | null {
  const { basis } = input.tickets
  if (input.totalCents <= 0) return { perUnitCents: 0, basis, approximated: basis !== 'identified', assumption: 'Sem custo por transação no período' }
  if (input.units <= 0) return null

  const average = input.totalCents / input.units
  const where = `média da ${input.scope} por unidade vendida`
  const assumption =
    basis === 'identified'
      ? `Tickets identificados pelo código da compra; custo ${where}. Um produto vendido sozinho carrega o ticket inteiro e um em cesta grande carrega uma fração, então o seu custo real pode diferir da média`
      : basis === 'estimated'
        ? `${input.tickets.linesWithoutTicketId} de ${input.lines} linhas (${ratio(input.tickets.linesWithoutTicketId, input.lines)}) sem identificador de compra tiveram os tickets ESTIMADOS pela proporção das demais; custo ${where}`
        : `Poucas linhas trazem o identificador da compra (${input.tickets.linesWithoutTicketId} de ${input.lines} sem ele): os tickets são desconhecidos e não foram supostos; custo ${where}`

  return { perUnitCents: average, basis, approximated: basis !== 'identified', assumption }
}

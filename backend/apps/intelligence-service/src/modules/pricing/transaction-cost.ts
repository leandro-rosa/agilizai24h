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
  const bySku = new Map<string, number>()
  const unitsBySku = new Map<string, number>()
  if (usable.length === 0) return { bySku, unitsBySku, distributedCents: 0 }

  const perTicket = split(totalCents, usable.map(() => 1))
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
  /** The hypothesis the number rests on, in words, so it is never read as measured. */
  assumption: string
}

/**
 * The cost per unit when only aggregates are known: the ticket count and the average lines per unit. With no coupon in the sales detail every line counts
 * as a ticket, so the units of a line share one ticket's cost and a product's cost per unit is `total / tickets × lines / units` — the same figure
 * `distributeTransactionCost` gives when each ticket is one line. `null` without tickets or units (nothing to base it on).
 */
export function perUnitTransactionCost(totalCents: number, tickets: number, linesPerUnit: number, scope: string): PerUnitEstimate | null {
  if (totalCents <= 0) return { perUnitCents: 0, assumption: 'Sem custo por transação no período' }
  if (tickets <= 0 || linesPerUnit <= 0) return null

  return {
    perUnitCents: (totalCents / tickets) * linesPerUnit,
    assumption: `Cada linha de venda conta como um ticket (o detalhe de vendas não traz o cupom) e o produto vende a média ${scope} de ${linesPerUnit.toFixed(2).replace('.', ',')} linha por unidade`,
  }
}

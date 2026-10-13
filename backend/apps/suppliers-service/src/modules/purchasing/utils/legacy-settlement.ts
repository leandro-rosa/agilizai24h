import type { DayInterval } from './settlement-coverage'
import { addDays, isDay } from './week'

export interface LegacyLineInput {
  name: string
  /** Null when the spreadsheet line has no SKU yet: the name is the identification, and nothing is guessed. */
  sku?: string | null
  unit_cost_cents: number
  quantity: number
  total_cents: number
}

export interface LegacyInput {
  /** First covered day, included. */
  period_from: string
  /** Last covered day, included. */
  period_to: string
  paid_on: string
  total_cents: number
  lines: LegacyLineInput[]
  source?: string
  actor?: string
}

/** What `settlement.evidence` holds for a historical settlement: `lines` stays empty so nothing that reads it is ever misled. */
export interface LegacyEvidence {
  kind: 'legacy'
  lines: []
  soldNotCovered: Record<string, never>
  quality: { salesUnknown: false; monthsWithoutDatedReceipts: []; storesMissing: 0 }
  formula: string
  source: string
  registered_by: string | null
  legacy_lines: Array<{ name: string; sku: string | null; unit_cost_cents: number; quantity: number; total_cents: number }>
}

const isCents = (value: number) => Number.isInteger(value) && value >= 0

/** Every problem at once; an empty list means the settlement can be registered. */
export function validateLegacy(input: LegacyInput): string[] {
  const problems: string[] = []

  if (!isDay(input.period_from)) problems.push('period_from must be a real date, YYYY-MM-DD')
  if (!isDay(input.period_to)) problems.push('period_to must be a real date, YYYY-MM-DD')
  if (!isDay(input.paid_on)) problems.push('paid_on must be a real date, YYYY-MM-DD')

  if (isDay(input.period_from) && isDay(input.period_to) && input.period_to < input.period_from) problems.push('period_to cannot be before period_from')
  if (isDay(input.period_to) && isDay(input.paid_on) && input.paid_on < input.period_to) problems.push(`paid_on cannot be before the last covered day (${input.period_to})`)

  if (input.lines.length === 0) problems.push('at least one line is required')

  let sum = 0
  for (const line of input.lines) {
    const label = line.name.trim() === '' ? 'a line without a name' : `line "${line.name}"`
    if (line.name.trim() === '') problems.push('every line needs a name')
    if (!Number.isInteger(line.quantity) || line.quantity < 0) problems.push(`${label}: quantity must be a whole number, zero or more`)
    if (!isCents(line.unit_cost_cents)) problems.push(`${label}: unit_cost_cents must be a whole number of cents, zero or more`)
    if (!isCents(line.total_cents)) problems.push(`${label}: total_cents must be a whole number of cents, zero or more`)
    if (Number.isInteger(line.quantity) && isCents(line.unit_cost_cents) && isCents(line.total_cents) && line.quantity * line.unit_cost_cents !== line.total_cents)
      problems.push(`${label}: ${line.quantity} × ${line.unit_cost_cents} = ${line.quantity * line.unit_cost_cents}, not ${line.total_cents}`)
    sum += Number.isFinite(line.total_cents) ? line.total_cents : 0
  }

  if (!isCents(input.total_cents)) problems.push('total_cents must be a whole number of cents, zero or more')
  else if (input.lines.length > 0 && sum !== input.total_cents) problems.push(`total ${input.total_cents} is not the sum of the lines (${sum})`)

  return problems
}

/** [period_from, period_to + 1 day): both selected days entirely. */
export function legacyInterval(input: LegacyInput): DayInterval {
  return { from: input.period_from, until: addDays(input.period_to, 1) }
}

export function legacyEvidence(input: LegacyInput): LegacyEvidence {
  return {
    kind: 'legacy',
    lines: [],
    soldNotCovered: {},
    quality: { salesUnknown: false, monthsWithoutDatedReceipts: [], storesMissing: 0 },
    formula: 'acerto histórico, já pago: quantidade × custo acordado, registrado a partir da planilha',
    source: input.source ?? 'planilha',
    registered_by: input.actor ?? null,
    legacy_lines: input.lines.map(line => ({ name: line.name, sku: line.sku ?? null, unit_cost_cents: line.unit_cost_cents, quantity: line.quantity, total_cents: line.total_cents })),
  }
}

import { legacyEvidence, legacyInterval, validateLegacy, type LegacyInput } from './legacy-settlement'

const valid = (over: Partial<LegacyInput> = {}): LegacyInput => ({
  period_from: '2026-09-22',
  period_to: '2026-09-29',
  paid_on: '2026-09-30',
  total_cents: 22155,
  lines: [
    { name: 'Pão de mel', sku: '110022', unit_cost_cents: 730, quantity: 30, total_cents: 21900 },
    { name: 'Pizza de marguerita', sku: '9992', unit_cost_cents: 792, quantity: 1, total_cents: 792 },
    { name: 'Pudim', sku: null, unit_cost_cents: 693, quantity: 0, total_cents: 0 },
  ],
  ...over,
})

describe('validateLegacy — a historical settlement must add up before it is registered', () => {
  it('accepts lines whose quantity × cost is the line total and whose lines sum to the total', () => {
    expect(validateLegacy(valid({ total_cents: 22692 }))).toEqual([])
  })

  it('reports every problem at once, not only the first', () => {
    const problems = validateLegacy(valid({ period_to: '2026-09-10', paid_on: '2026-09-05', total_cents: 1, lines: [{ name: '', unit_cost_cents: -1, quantity: 1.5, total_cents: 5 }] }))

    expect(problems.length).toBeGreaterThanOrEqual(5)
  })

  it('refuses a line whose total is not quantity × cost', () => {
    const problems = validateLegacy(valid({ lines: [{ name: 'Pão de mel', unit_cost_cents: 730, quantity: 30, total_cents: 21000 }], total_cents: 21000 }))

    expect(problems).toContain('line "Pão de mel": 30 × 730 = 21900, not 21000')
  })

  it('refuses a total different from the sum of the lines', () => {
    expect(validateLegacy(valid({ total_cents: 22155 }))).toContain('total 22155 is not the sum of the lines (22692)')
  })

  it('refuses a payment date before the last covered day, and an inverted period', () => {
    expect(validateLegacy(valid({ total_cents: 22692, paid_on: '2026-09-28' }))).toContain('paid_on cannot be before the last covered day (2026-09-29)')
    expect(validateLegacy(valid({ total_cents: 22692, period_from: '2026-09-30', period_to: '2026-09-29' }))).toContain('period_to cannot be before period_from')
  })

  it('refuses no lines and impossible dates', () => {
    expect(validateLegacy(valid({ lines: [], total_cents: 0 }))).toContain('at least one line is required')
    expect(validateLegacy(valid({ total_cents: 22692, period_from: '2026-02-30' }))).toContain('period_from must be a real date, YYYY-MM-DD')
  })
})

describe('legacyInterval / legacyEvidence', () => {
  it('covers period_from through period_to, both included', () => {
    expect(legacyInterval(valid())).toEqual({ from: '2026-09-22', until: '2026-09-30' })
  })

  it('keeps the lines apart from `evidence.lines`, which the regular settlement reads, and says where it came from', () => {
    const evidence = legacyEvidence(valid({ total_cents: 22692, source: 'planilha do fornecedor', actor: 'dono@agiliz' }))

    expect(evidence.lines).toEqual([])
    expect(evidence.kind).toBe('legacy')
    expect(evidence.source).toBe('planilha do fornecedor')
    expect(evidence.registered_by).toBe('dono@agiliz')
    expect(evidence.legacy_lines).toHaveLength(3)
    expect(evidence.legacy_lines[0]).toEqual({ name: 'Pão de mel', sku: '110022', unit_cost_cents: 730, quantity: 30, total_cents: 21900 })
    expect(evidence.legacy_lines[2].sku).toBeNull()
  })
})

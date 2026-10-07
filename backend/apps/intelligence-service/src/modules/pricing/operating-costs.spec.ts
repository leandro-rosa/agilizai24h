import type { PnlAccountDto, PnlDto } from '../sources/accounting.client'
import { DEFAULT_ACCOUNT_BEHAVIOR, DEFAULT_PRICING_PARAMETERS, mergePricingParameters, validatePricingParameters } from './pricing.parameters'
import { legacyShifts, operatingCosts } from './operating-costs'
import type { OperatingClass } from './pricing.types'

const account = (code: string, label: string, amount_cents: number, children: PnlAccountDto[] = []): PnlAccountDto => ({ code, label, section: '', amount_cents, children })

const pnl = (period: string, storeRevenue: number, extra: PnlAccountDto[] = []): PnlDto => ({
  period,
  store_id: null,
  sections: [
    { section: 'gross_revenue', amount_cents: storeRevenue, accounts: [account('3.1.01', 'Vendas lojas', storeRevenue), account('3.1.03', 'Mensalidades', 50_000)] },
    { section: 'deductions', amount_cents: 9_000, accounts: [account('3.2.01', 'Impostos', 7_000), account('3.2.04', 'Taxas da maquininha', 2_000)] },
    { section: 'cogs', amount_cents: 70_000, accounts: [account('4.1.01', 'Compra', 60_000), account('4.1.02', 'Compra coffee break', 6_000), account('4.1.03', 'Compra frutas', 4_000)] },
    {
      section: 'variable_expenses',
      amount_cents: 0,
      accounts: [
        account('4.2.01', 'Repasse de vendas', 1_000),
        account('4.2.02', 'Perdas e roubos', 7_000),
        // The parent already sums its children: reading Gasolina too would count it twice.
        account('4.2.03', 'Deslocamento', 3_000, [account('4.2.04', 'Gasolina', 2_000), account('4.2.05', 'Pedágio', 1_000)]),
        ...extra,
      ],
    },
    { section: 'fixed_expenses', amount_cents: 0, accounts: [account('4.3.01', 'Mensalidade touchpay', 4_000), account('4.3.04', 'Luz', 1_000)] },
    { section: 'financial_expenses', amount_cents: 0, accounts: [account('4.4.01', 'Juros', 9_999)] },
  ],
})

const BEHAVIOR = DEFAULT_ACCOUNT_BEHAVIOR
const run = (pnls: (PnlDto | null)[], behavior: Record<string, OperatingClass> = BEHAVIOR, bps = 50) => operatingCosts(pnls, behavior, bps)!

describe('operatingCosts', () => {
  it('puts each account in the class of its behaviour, whatever section it was filed under', () => {
    const result = run([pnl('2026-09', 100_000)])

    expect(result.classes.percent_of_sales.costCents).toBe(1_000) // Repasse
    expect(result.classes.per_visit.costCents).toBe(3_000) // Deslocamento, its children are not read
    expect(result.classes.fixed.costCents).toBe(5_000) // Touchpay + Luz
    expect(result.classes.per_transaction.costCents).toBe(0)
    expect(result.classes.percent_of_sales.share).toBeCloseTo(0.01, 10)
  })

  it('keeps coffee break and fruit purchases out of the price: they are the cost of the other revenues', () => {
    const result = run([pnl('2026-09', 100_000)])

    expect(result.classes.other_revenue_cost.accounts.map(a => a.code)).toEqual(['4.1.02', '4.1.03'])
    expect(result.classes.other_revenue_cost.costCents).toBe(10_000)
    for (const name of ['percent_of_sales', 'per_transaction'] as const) {
      expect(result.classes[name].accounts.map(a => a.code)).not.toEqual(expect.arrayContaining(['4.1.02']))
    }
  })

  it('counts each account in exactly one class, and tax, fees, loss and purchases only as components', () => {
    const result = run([pnl('2026-09', 100_000)])
    const seen = new Map<string, number>()
    for (const total of [...Object.values(result.classes)]) for (const a of total.accounts) seen.set(a.code, (seen.get(a.code) ?? 0) + 1)
    for (const a of result.unclassified) seen.set(a.code, (seen.get(a.code) ?? 0) + 1)

    expect([...seen.values()].every(count => count === 1)).toBe(true)
    expect(result.classes.already_component.accounts.map(a => a.code).sort()).toEqual(['3.2.01', '3.2.04', '4.1.01', '4.2.02'])
    expect(result.classes.percent_of_sales.accounts.map(a => a.code)).toEqual(['4.2.01'])
    expect(seen.has('4.2.04')).toBe(false) // child of Deslocamento
    expect(seen.has('4.4.01')).toBe(false) // financing is not operation
  })

  it('cannot be tricked into counting tax or loss twice: the locked accounts stay components even if mapped elsewhere', () => {
    const result = run([pnl('2026-09', 100_000)], { ...BEHAVIOR, '4.2.02': 'percent_of_sales', '3.2.01': 'percent_of_sales', '4.1.01': 'fixed' })

    expect(result.classes.percent_of_sales.accounts.map(a => a.code)).toEqual(['4.2.01'])
    expect(result.classes.fixed.accounts.map(a => a.code)).not.toContain('4.1.01')
    expect(result.classes.already_component.accounts.map(a => a.code)).toEqual(expect.arrayContaining(['4.2.02', '3.2.01', '4.1.01']))
  })

  it('refuses to map a locked account to another class in the parameters', () => {
    const bad = mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { operating: { accountBehavior: { ...BEHAVIOR, '4.2.02': 'percent_of_sales' } } })

    expect(validatePricingParameters(bad).join(' ')).toContain('4.2.02')
    expect(validatePricingParameters(mergePricingParameters(DEFAULT_PRICING_PARAMETERS, { operating: { accountBehavior: { ...BEHAVIOR, '4.2.99': 'weekly' as never } } })).join(' ')).toContain('4.2.99')
  })

  it('lists an account with no class, with its value, and marks the calculation incomplete when it is relevant', () => {
    const marketing = account('4.2.07', 'Marketing', 2_000)
    const relevant = run([pnl('2026-09', 100_000, [marketing])])

    expect(relevant.unclassified).toEqual([{ code: '4.2.07', label: 'Marketing', amountCents: 2_000 }])
    expect(relevant.unclassifiedShare).toBeCloseTo(0.02, 10)
    expect(relevant.complete).toBe(false)
    expect(Object.values(relevant.classes).flatMap(total => total.accounts.map(a => a.code))).not.toContain('4.2.07')

    // Below the configured relevance (0.5% of store revenue) it is still listed, but does not block.
    const small = run([pnl('2026-09', 100_000, [account('4.2.07', 'Marketing', 300)])])
    expect(small.unclassified).toHaveLength(1)
    expect(small.complete).toBe(true)
  })

  it('is complete with nothing unclassified, and each class reports its accounts', () => {
    const result = run([pnl('2026-09', 100_000)])

    expect(result.unclassified).toEqual([])
    expect(result.complete).toBe(true)
  })

  it('pools months by revenue rather than averaging percentages', () => {
    const result = run([pnl('2026-08', 100_000), pnl('2026-09', 300_000)])

    expect(result.revenueCents).toBe(400_000)
    expect(result.classes.per_visit.costCents).toBe(6_000)
    expect(result.months).toEqual(['2026-08', '2026-09'])
  })

  it('ignores months that were never computed and is null with no revenue', () => {
    expect(run([null, pnl('2026-09', 100_000)]).months).toEqual(['2026-09'])
    expect(operatingCosts([null], BEHAVIOR, 50)).toBeNull()
    expect(operatingCosts([pnl('2026-09', 0)], BEHAVIOR, 50)).toBeNull()
  })

  it('keeps the old method total to reconcile: every variable and fixed account but loss', () => {
    const result = run([pnl('2026-09', 100_000)])

    // repasse 1.000 + deslocamento 3.000 + touchpay 4.000 + luz 1.000
    expect(result.legacy.costCents).toBe(9_000)
    expect(result.legacy.share).toBeCloseTo(0.09, 10)
  })
})

describe('legacyShifts — what the new classes change against the old method', () => {
  it('moves each class out of the old share and every moved share adds up to the difference', () => {
    const result = run([pnl('2026-09', 100_000, [account('4.2.07', 'Marketing', 2_000)])])
    const { shifts, perTransactionLegacyShare } = legacyShifts(result)
    const by = (name: string) => shifts.find(shift => shift.class === name)?.share

    expect(by('per_visit')).toBeCloseTo(0.03, 10)
    expect(by('fixed')).toBeCloseTo(0.05, 10)
    expect(by('unclassified')).toBeCloseTo(0.02, 10)
    expect(by('percent_of_sales')).toBeUndefined() // it stays in the price: nothing moved
    expect(by('other_revenue_cost')).toBeUndefined() // coffee break and fruits were never in the old share (they are purchases)
    expect(perTransactionLegacyShare).toBe(0)
    // old share 11% (repasse 1 + deslocamento 3 + marketing 2 + touchpay 4 + luz 1) - new price share 1% = 10% moved.
    expect(shifts.reduce((sum, shift) => sum + shift.share, 0)).toBeCloseTo(result.legacy.share - result.classes.percent_of_sales.share, 10)
  })

  it('an expense the price now carries and the old method did not lowers the margin (negative shift)', () => {
    const result = run([pnl('2026-09', 100_000)], { ...BEHAVIOR, '4.1.02': 'percent_of_sales' })
    const { shifts } = legacyShifts(result)

    expect(shifts.find(shift => shift.class === 'percent_of_sales')?.share).toBeCloseTo(-0.06, 10)
  })

  it('an expense in the per-transaction class leaves the old share and is reported to the caller for the change of base', () => {
    const result = run([pnl('2026-09', 100_000, [account('4.2.08', 'Custo por transação', 2_000)])], { ...BEHAVIOR, '4.2.08': 'per_transaction' })
    const { shifts, perTransactionLegacyShare } = legacyShifts(result)

    expect(perTransactionLegacyShare).toBeCloseTo(0.02, 10)
    expect(shifts.find(shift => shift.class === 'per_transaction')).toBeUndefined()
  })
})

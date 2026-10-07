import type { PnlAccountDto, PnlDto } from '../sources/accounting.client'
import { operatingShare } from './operating-share'

const account = (code: string, label: string, amount_cents: number, children: PnlAccountDto[] = []): PnlAccountDto => ({ code, label, section: '', amount_cents, children })

const pnl = (period: string, storeRevenue: number): PnlDto => ({
  period,
  store_id: null,
  sections: [
    { section: 'gross_revenue', amount_cents: storeRevenue, accounts: [account('3.1.01', 'Vendas lojas', storeRevenue), account('3.1.03', 'Mensalidades', 50_000)] },
    { section: 'deductions', amount_cents: 9_000, accounts: [account('3.2.01', 'Impostos', 7_000), account('3.2.04', 'Taxas da maquininha', 2_000)] },
    { section: 'cogs', amount_cents: 60_000, accounts: [account('4.1.01', 'Compra', 60_000)] },
    {
      section: 'variable_expenses',
      amount_cents: 0,
      accounts: [
        account('4.2.01', 'Repasse de vendas', 1_000),
        account('4.2.02', 'Perdas e roubos', 7_000),
        // The parent already sums its children: reading Gasolina too would count it twice.
        account('4.2.03', 'Deslocamento', 3_000, [account('4.2.04', 'Gasolina', 2_000), account('4.2.05', 'Pedágio', 1_000)]),
      ],
    },
    { section: 'fixed_expenses', amount_cents: 0, accounts: [account('4.3.01', 'Mensalidade touchpay', 4_000), account('4.3.04', 'Luz', 1_000)] },
    { section: 'financial_expenses', amount_cents: 0, accounts: [account('4.4.01', 'Juros', 9_999)] },
  ],
})

describe('operatingShare', () => {
  it('sums operating expenses over store sales, once each', () => {
    const result = operatingShare([pnl('2026-09', 100_000)])!

    // repasse 1.000 + deslocamento 3.000 + touchpay 4.000 + luz 1.000 = 9.000
    expect(result.costCents).toBe(9_000)
    expect(result.share).toBeCloseTo(0.09, 8)
  })

  it('leaves out what is already another component', () => {
    const codes = operatingShare([pnl('2026-09', 100_000)])!.accounts.map(a => a.code)

    expect(codes).not.toContain('4.2.02') // loss
    expect(codes).not.toContain('3.2.01') // tax
    expect(codes).not.toContain('3.2.04') // card fees
    expect(codes).not.toContain('4.1.01') // purchases
    expect(codes).not.toContain('4.4.01') // financing
    expect(codes).not.toContain('4.2.04') // child of Deslocamento
  })

  it('pools months by revenue rather than averaging percentages', () => {
    const result = operatingShare([pnl('2026-08', 100_000), pnl('2026-09', 300_000)])!

    expect(result.revenueCents).toBe(400_000)
    expect(result.costCents).toBe(18_000)
    expect(result.months).toEqual(['2026-08', '2026-09'])
  })

  it('ignores months that were never computed and is null with no revenue', () => {
    expect(operatingShare([null, pnl('2026-09', 100_000)])!.months).toEqual(['2026-09'])
    expect(operatingShare([null])).toBeNull()
    expect(operatingShare([pnl('2026-09', 0)])).toBeNull()
  })
})

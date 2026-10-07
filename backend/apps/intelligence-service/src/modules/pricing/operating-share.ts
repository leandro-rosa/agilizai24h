import type { PnlDto } from '../sources/accounting.client'

/**
 * Accounts of the DRE that no other component of the price already carries:
 * tax and fees (deductions) are the tax and payment components, purchases are
 * the product cost, and losses (4.2.02) are the loss component. Financial
 * expenses are financing, not operation.
 */
const ALREADY_A_COMPONENT = new Set(['4.2.02'])
const OPERATING_SECTIONS = new Set(['variable_expenses', 'fixed_expenses'])
const STORE_REVENUE = '3.1.01'

export interface OperatingShare {
  /** Operating cost per unit of store-sales revenue, a fraction. */
  share: number
  costCents: number
  revenueCents: number
  months: string[]
  /** What the share is made of, for the "estrutura considerada" panel. */
  accounts: { code: string; label: string; amountCents: number }[]
}

/**
 * The operating allocation of the price: variable and fixed operating expenses
 * (not loss, tax, fees or purchases) over the revenue of store sales, summed
 * over the months given. Only top-level accounts are read — a parent already
 * sums its children (Deslocamento carries Gasolina and Pedágio), so reading
 * both would count an expense twice. It is an allocation for price analysis and
 * is never written back as an entry. `null` when no month has store revenue.
 */
export function operatingShare(pnls: (PnlDto | null)[]): OperatingShare | null {
  const real = pnls.filter((pnl): pnl is PnlDto => pnl !== null)
  const byAccount = new Map<string, { label: string; amountCents: number }>()
  let revenue = 0
  const months: string[] = []

  for (const pnl of real) {
    const revenueRoot = pnl.sections.find(section => section.section === 'gross_revenue')?.accounts.find(account => account.code === STORE_REVENUE)
    if (!revenueRoot || revenueRoot.amount_cents <= 0) continue

    revenue += revenueRoot.amount_cents
    months.push(pnl.period)

    for (const section of pnl.sections) {
      if (!OPERATING_SECTIONS.has(section.section)) continue
      for (const account of section.accounts) {
        if (ALREADY_A_COMPONENT.has(account.code)) continue
        const entry = byAccount.get(account.code) ?? { label: account.label, amountCents: 0 }
        entry.amountCents += account.amount_cents
        byAccount.set(account.code, entry)
      }
    }
  }

  if (revenue <= 0) return null

  const accounts = [...byAccount.entries()].map(([code, entry]) => ({ code, label: entry.label, amountCents: entry.amountCents })).filter(account => account.amountCents !== 0)
  const cost = accounts.reduce((sum, account) => sum + account.amountCents, 0)

  return { share: cost / revenue, costCents: cost, revenueCents: revenue, months, accounts }
}

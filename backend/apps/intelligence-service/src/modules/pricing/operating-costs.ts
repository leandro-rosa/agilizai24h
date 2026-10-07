import type { PnlAccountDto, PnlDto } from '../sources/accounting.client'
import { OPERATING_CLASSES, type OperatingClass } from './pricing.types'

/** Sections whose top-level accounts are read. Financial expenses are financing, not operation, and are never read. */
const CLASSIFIED_SECTIONS = new Set(['cogs', 'variable_expenses', 'fixed_expenses'])
/** The sections the OLD method summed (everything but the loss account), kept only to explain the difference to the new one. */
const LEGACY_SECTIONS = new Set(['variable_expenses', 'fixed_expenses'])
const LEGACY_EXCLUDED = new Set(['4.2.02'])
const STORE_REVENUE = '3.1.01'

/**
 * Accounts that are ALREADY a component of the price (or of the product cost) and cannot be reclassified: tax and card fees (the whole deductions
 * section), the loss account (the loss component) and the store purchases (the product cost). Letting an owner map one of them to another class would
 * count it twice, so the parameters refuse it.
 */
export const LOCKED_COMPONENT_CODES = ['4.1.01', '4.2.02']
export const isLockedComponent = (code: string): boolean => LOCKED_COMPONENT_CODES.includes(code) || code.startsWith('3.2.')

export interface OperatingAccount {
  code: string
  label: string
  amountCents: number
}

export interface ClassTotal {
  costCents: number
  /** The class cost over the revenue of store sales in the window, a fraction. */
  share: number
  accounts: OperatingAccount[]
}

export interface OperatingCosts {
  /** Revenue of store sales (3.1.01) of the months that have it, and which months those are. */
  revenueCents: number
  months: string[]
  classes: Record<OperatingClass, ClassTotal>
  /** Expenses with no class: outside the price, listed with their value so nothing is hidden. */
  unclassified: OperatingAccount[]
  unclassifiedCents: number
  unclassifiedShare: number
  /** False when the unclassified expenses are above the configured relevance: no recommendation may be shown as validated. */
  complete: boolean
  /** What the OLD method (every variable and fixed expense but loss, over the same revenue) would have used, to reconcile with the new classification. */
  legacy: { share: number; costCents: number; accounts: OperatingAccount[] }
}

const empty = (): Record<OperatingClass, ClassTotal> => Object.fromEntries(OPERATING_CLASSES.map(name => [name, { costCents: 0, share: 0, accounts: [] }])) as unknown as Record<OperatingClass, ClassTotal>

function add(target: Map<string, OperatingAccount>, account: PnlAccountDto) {
  const entry = target.get(account.code) ?? { code: account.code, label: account.label, amountCents: 0 }
  entry.amountCents += account.amount_cents
  target.set(account.code, entry)
}

/**
 * Classifies every expense of the DRE by how it behaves, instead of by the section it was filed under. Only top-level accounts are read — a parent
 * already sums its children (Deslocamento carries Gasolina and Pedágio), so reading both would count an expense twice. Each account lands in exactly ONE
 * class: the deductions section and the locked accounts are always `already_component`; any other account takes the class the owner gave it, and an
 * account with none is `unclassified`. Months without store revenue are skipped; months are pooled by revenue, never averaged as percentages. It is an
 * allocation for price analysis and is never written back as an entry. `null` when no month has store revenue.
 */
export function operatingCosts(pnls: (PnlDto | null)[], behavior: Record<string, OperatingClass>, relevantBps: number): OperatingCosts | null {
  const byClass = new Map<OperatingClass, Map<string, OperatingAccount>>(OPERATING_CLASSES.map(name => [name, new Map()]))
  const unclassified = new Map<string, OperatingAccount>()
  const legacy = new Map<string, OperatingAccount>()
  const months: string[] = []
  let revenue = 0

  for (const pnl of pnls) {
    if (!pnl) continue
    const revenueRoot = pnl.sections.find(section => section.section === 'gross_revenue')?.accounts.find(account => account.code === STORE_REVENUE)
    if (!revenueRoot || revenueRoot.amount_cents <= 0) continue

    revenue += revenueRoot.amount_cents
    months.push(pnl.period)

    for (const section of pnl.sections) {
      const isDeduction = section.section === 'deductions'
      if (!isDeduction && !CLASSIFIED_SECTIONS.has(section.section)) continue

      for (const account of section.accounts) {
        if (LEGACY_SECTIONS.has(section.section) && !LEGACY_EXCLUDED.has(account.code)) add(legacy, account)

        const given = behavior[account.code]
        if (isDeduction || isLockedComponent(account.code)) add(byClass.get('already_component') as Map<string, OperatingAccount>, account)
        else if (given) add(byClass.get(given) as Map<string, OperatingAccount>, account)
        else add(unclassified, account)
      }
    }
  }

  if (revenue <= 0) return null

  const listed = (accounts: Map<string, OperatingAccount>) => [...accounts.values()].filter(account => account.amountCents !== 0)
  const sum = (accounts: OperatingAccount[]) => accounts.reduce((total, account) => total + account.amountCents, 0)

  const classes = empty()
  for (const name of OPERATING_CLASSES) {
    const accounts = listed(byClass.get(name) as Map<string, OperatingAccount>)
    const costCents = sum(accounts)
    classes[name] = { costCents, share: costCents / revenue, accounts }
  }

  const unclassifiedAccounts = listed(unclassified)
  const unclassifiedCents = sum(unclassifiedAccounts)
  const legacyAccounts = listed(legacy)
  const legacyCents = sum(legacyAccounts)

  return {
    revenueCents: revenue,
    months,
    classes,
    unclassified: unclassifiedAccounts,
    unclassifiedCents,
    unclassifiedShare: unclassifiedCents / revenue,
    complete: unclassifiedCents / revenue <= relevantBps / 10_000 + 1e-12,
    legacy: { share: legacyCents / revenue, costCents: legacyCents, accounts: legacyAccounts },
  }
}

export interface LegacyShift {
  class: OperatingClass | 'unclassified'
  label: string
  /** What leaving (or entering) the price does to the margin at ANY price, as a fraction of the price: positive raises the new margin above the old one. */
  share: number
}

const SHIFT_LABELS: Record<OperatingClass | 'unclassified', string> = {
  percent_of_sales: 'Despesa proporcional à venda (continua no preço)',
  per_transaction: 'Custo por transação: de % da receita para valor por unidade (mudança de base)',
  per_visit: 'Deslocamento por visita saiu do preço (viabilidade da rota ou loja)',
  fixed: 'Custos fixos saíram do preço (resultado operacional e ponto de equilíbrio)',
  other_revenue_cost: 'Despesas de outras atividades (coffee break, frutas) removidas do preço',
  already_component: 'Dupla contagem corrigida (já é imposto, taxa, perda ou compra)',
  unclassified: 'Despesas sem classificação ficaram fora do preço (cálculo incompleto)',
}

/**
 * Explains, per class, how the new classification differs from the old method (every variable and fixed expense but loss, as a share of the price). At
 * any price, `new margin − old margin = Σ shift shares − per-transaction money ÷ price`: an account that was in the old share and is not in the price
 * now raises the margin by its share; an account the price now carries and the old one did not lowers it. The per-transaction money term depends on the
 * price and is added by the caller. Only classes that moved something are returned.
 */
export function legacyShifts(costs: OperatingCosts): { shifts: LegacyShift[]; perTransactionLegacyShare: number } {
  const legacy = new Map(costs.legacy.accounts.map(account => [account.code, account.amountCents]))
  const shifts: LegacyShift[] = []
  let perTransactionLegacyShare = 0

  const classOf = new Map<string, OperatingClass | 'unclassified'>()
  for (const name of OPERATING_CLASSES) for (const account of costs.classes[name].accounts) classOf.set(account.code, name)
  for (const account of costs.unclassified) classOf.set(account.code, 'unclassified')

  const totals = new Map<OperatingClass | 'unclassified', number>()
  const codes = new Set([...legacy.keys(), ...classOf.keys()])
  for (const code of codes) {
    const group = classOf.get(code)
    if (!group) continue
    const before = (legacy.get(code) ?? 0) / costs.revenueCents
    // Only percent_of_sales stays in the price as a share; per_transaction becomes money per unit (handled by the caller).
    const after = group === 'percent_of_sales' ? (costs.classes.percent_of_sales.accounts.find(account => account.code === code)?.amountCents ?? 0) / costs.revenueCents : 0
    if (group === 'per_transaction') perTransactionLegacyShare += before
    totals.set(group, (totals.get(group) ?? 0) + (before - after))
  }

  for (const [group, share] of totals) {
    if (group === 'per_transaction') continue
    if (Math.abs(share) < 1e-12) continue
    shifts.push({ class: group, label: SHIFT_LABELS[group], share })
  }

  return { shifts, perTransactionLegacyShare }
}

export const PER_TRANSACTION_SHIFT_LABEL = SHIFT_LABELS.per_transaction

/** Vocabulário de faturamento. */

export const SEGMENTS = ['company', 'condominium'] as const
export type Segment = (typeof SEGMENTS)[number]

export const CONTRACT_KINDS = ['partnership', 'monthly_fee', 'revenue_share', 'coffee_break'] as const
export type ContractKind = (typeof CONTRACT_KINDS)[number]

export const CONTRACT_STATUSES = ['draft', 'active', 'ended'] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

export const INVOICE_KINDS = ['monthly_fee', 'coffee_break', 'revenue_share', 'other'] as const
export type InvoiceKind = (typeof INVOICE_KINDS)[number]

/**
 * "Vencido" não está aqui de propósito: é derivado de `due_on < hoje` com
 * `paid_on` nulo. Como status persistido precisaria de um job diário mudando
 * linha, e o histórico passaria a depender de ele ter rodado.
 */
export const INVOICE_STATUSES = ['issued', 'paid', 'cancelled'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** Faixas de atraso do painel de aging, em dias. */
export const AGING_BUCKETS = [
  { key: 'not_due', label: 'A vencer', min: Number.NEGATIVE_INFINITY, max: 0 },
  { key: 'd1_30', label: 'Vencido 1–30', min: 1, max: 30 },
  { key: 'd31_60', label: 'Vencido 31–60', min: 31, max: 60 },
  { key: 'd60_plus', label: 'Vencido 60+', min: 61, max: Number.POSITIVE_INFINITY },
] as const

export type AgingBucketKey = (typeof AGING_BUCKETS)[number]['key']

/**
 * Dias de atraso de uma nota na data de referência. Compara só a parte de
 * data: uma nota que vence hoje não está vencida, e comparar com hora faria
 * ela virar "vencida" a partir de 00:00:01.
 */
export function daysOverdue(dueOn: Date, reference: Date): number {
  const due = Date.UTC(dueOn.getUTCFullYear(), dueOn.getUTCMonth(), dueOn.getUTCDate())
  const ref = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate())

  return Math.floor((ref - due) / 86_400_000)
}

export function agingBucket(dueOn: Date, reference: Date): AgingBucketKey {
  const days = daysOverdue(dueOn, reference)
  const bucket = AGING_BUCKETS.find(b => days >= b.min && days <= b.max)

  return bucket?.key ?? 'not_due'
}

/** Vencimento derivado da emissão — nunca aceito do chamador. */
export function dueDate(issuedOn: Date, termDays: number): Date {
  const due = new Date(issuedOn)
  due.setUTCDate(due.getUTCDate() + termDays)

  return due
}

/** Repasse: percentual em basis points sobre a receita base, em centavos. */
export function revenueShareCents(baseRevenueCents: number, rateBps: number): number {
  return Math.round((baseRevenueCents * rateBps) / 10_000)
}

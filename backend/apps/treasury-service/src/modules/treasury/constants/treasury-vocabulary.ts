/**
 * Vocabulário fechado da tesouraria. Fora do Prisma como enum pelo mesmo
 * motivo dos outros serviços: acrescentar um valor não deve pedir migration.
 */
export const ACCOUNT_KINDS = ['checking', 'credit_card'] as const
export type AccountKind = (typeof ACCOUNT_KINDS)[number]

export const DIRECTIONS = ['inflow', 'outflow'] as const
export type Direction = (typeof DIRECTIONS)[number]

/**
 * O eixo "Natureza" da aba Página64, que é o que liga tesouraria a DRE:
 *
 * - `cogs`           — tudo que será vendido (a coluna "Estoque (CMV)")
 * - `operating`      — frete, coffee break, deslocamento
 * - `administrative` — sistema, contador, imposto, pró-labore
 * - `investment`     — equipamento, móvel, comunicação de loja
 */
export const NATURES = ['cogs', 'operating', 'administrative', 'investment'] as const
export type Nature = (typeof NATURES)[number]

export const PAYMENT_METHODS = ['debit', 'credit', 'pix', 'voucher'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/** "YYYY-MM" — mesmo formato de sales/supply/inventory/finance. */
export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** Mesmo dobramento do suppliers-service, para os dois lados casarem. */
export function normalizeCounterparty(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Aplica uma taxa em basis points sobre um valor em centavos.
 *
 * Arredonda para o inteiro mais próximo uma única vez, no fim: arredondar a
 * cada parcela e somar depois diverge do total do extrato em alguns centavos
 * por mês, e centavo que não bate vira hora de conciliação.
 */
export function feeCents(grossCents: number, rateBps: number): number {
  return Math.round((grossCents * rateBps) / 10_000)
}

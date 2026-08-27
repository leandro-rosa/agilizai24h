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
 *
 * Só se aplica a lançamento `kind: expense` — ver `KINDS` abaixo.
 */
export const NATURES = ['cogs', 'operating', 'administrative', 'investment'] as const
export type Nature = (typeof NATURES)[number]

/**
 * O eixo novo, independente de `nature`: é receita, é despesa real, é só
 * dinheiro se movendo entre contas da própria empresa, ou ainda não foi
 * identificado?
 *
 * - `revenue`  — venda, voucher, recebimento de cliente
 * - `expense`  — despesa real por fornecedor; só este carrega `nature`
 * - `movement` — transferência entre contas próprias, pagamento de fatura,
 *                CDB, empréstimo, retirada de sócio — nunca conta como
 *                receita nem despesa, não importa o valor
 * - `pending`  — favorecido ainda não resolvido; fica fora dos totais até
 *                ser classificado
 */
export const KINDS = ['revenue', 'expense', 'movement', 'pending'] as const
export type Kind = (typeof KINDS)[number]

/** Toda `CounterpartyMapping` resolve para um desses três — nunca `pending`: uma regra sempre resolve para algo. */
export const MAPPING_KINDS = ['revenue', 'expense', 'movement'] as const
export type MappingKind = (typeof MAPPING_KINDS)[number]

/**
 * `exact` — comportamento de sempre: bate só quando o texto normalizado do
 * favorecido é igual a `match_text`.
 * `contains` — novo: bate quando o texto normalizado CONTÉM `match_text`
 * como substring (regra de palavra-chave, ex.: "POSTO" ⇒ Combustível).
 */
export const MATCH_TYPES = ['exact', 'contains'] as const
export type MatchType = (typeof MATCH_TYPES)[number]

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

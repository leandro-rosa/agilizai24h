/**
 * Vocabulário fechado de categoria e status. Fica aqui, e não como enum do
 * Prisma, pelo mesmo motivo do `stores-service`: acrescentar um valor não
 * deve exigir migration, e o DTO valida contra esta lista.
 */
export const SUPPLIER_CATEGORIES = [
  'frozen',
  'beverages',
  'grocery',
  'wholesale',
  'equipment',
  'services',
  'system',
] as const

export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number]

export const SUPPLIER_STATUSES = ['active', 'inactive'] as const

export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number]

export const DEFAULT_LISTED_STATUSES: SupplierStatus[] = ['active']

/**
 * Dobra uma grafia para comparação tolerante: caixa, acento, pontuação e
 * espaço repetido não podem fazer duas grafias do mesmo fornecedor
 * discordarem. O extrato real carrega exatamente essa variação —
 * "ASSAÍ ATACADISTA LJ49" e "Assai Atacadista LJ 49" são o mesmo lugar.
 *
 * Deliberadamente NÃO remove o sufixo de loja (LJ49): duas filiais podem ser
 * fornecedores distintos para efeito de negociação, e essa decisão é de quem
 * cadastra o alias, não desta função.
 */
export function normalizeAlias(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

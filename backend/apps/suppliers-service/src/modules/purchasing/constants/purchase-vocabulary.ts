/** How an item is paid for. Chosen when the purchase is recorded; changeable until the item is settled. */
export const CONDITIONS = ['paid', 'bonus', 'on_sale'] as const
export type Condition = (typeof CONDITIONS)[number]

export const ORIGINS = ['manual', 'nfe'] as const
export type Origin = (typeof ORIGINS)[number]

export const PAYMENT_STATUSES = ['pending', 'paid'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const SETTLEMENT_STATES = ['proposal', 'confirmed', 'paid'] as const
export type SettlementState = (typeof SETTLEMENT_STATES)[number]

/** PT-BR labels for the screen; the codes above are what the API speaks. */
export const CONDITION_LABELS: Record<Condition, string> = { paid: 'Pago', bonus: 'Bonificação', on_sale: 'Consignado (pago sobre a venda)' }

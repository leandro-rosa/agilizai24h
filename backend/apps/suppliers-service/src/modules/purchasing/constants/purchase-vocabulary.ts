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

/** Order stages, in order. A purchase moves forward one stage at a time and is final at `received`. */
export const STAGES = ['requisition', 'awaiting_invoice', 'invoiced', 'awaiting_receipt', 'received'] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_LABELS: Record<Stage, string> = {
  requisition: 'Requisição de compra',
  awaiting_invoice: 'Aguardando faturamento',
  invoiced: 'Faturado',
  awaiting_receipt: 'Aguardando recebimento',
  received: 'Recebido',
}

export const PAYMENT_TERMS = ['on_receipt', 'due_date'] as const
export type PaymentTerm = (typeof PAYMENT_TERMS)[number]

/** How a purchase is paid: a boleto, a Pix/bank transfer, or something else. ("On delivery" is the payment TERM `on_receipt`, not a method.) */
export const PAYMENT_METHODS = ['boleto', 'transfer', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

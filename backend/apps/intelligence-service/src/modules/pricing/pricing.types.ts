export const ENGINE_VERSION = 'pricing-1'

export const PAYMENT_METHODS = ['pix', 'debit', 'credit', 'voucher'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const ANALYSIS_ONLY_STATEMENT = 'Rateio operacional utilizado exclusivamente para análise de preço. Não representa novo lançamento financeiro.'

/** Rates are basis points (139 = 1.39%), margins and shares are fractions (0.35 = 35%). */
export interface PricingParameters {
  margin: {
    /** The owner's reference (35%), not a constant: a new version changes it. */
    targetBps: number
    minimumBps: number
    categories: Record<string, { targetBps?: number; minimumBps?: number }>
  }
  /** `null` until the owner sets it — the engine refuses to recommend without one. */
  taxRateBps: number | null
  rounding: { stepCents: number }
  psychological: { enabled: boolean; endingCents: number }
  guards: {
    /** Largest single increase relative to the current price. */
    maxIncreaseBps: number
    /** Margin above target, still treated as an opportunity for a small step. */
    opportunityBandBps: number
  }
  data: {
    lookbackMonths: number
    /** Units per month below which a product is too thin for a confident recommendation. */
    minUnitsPerMonth: number
    /** Receipt lines of voucher sales needed to weight the voucher fee by brand. */
    voucherMinReceiptLines: number
    /** Units of a product's own loss history needed to use it instead of its category's. */
    lossMinUnits: number
    costMaxAgeDays: number
    stableCostBps: number
  }
  minConfidence: 'low' | 'medium' | 'high'
}

export type Confidence = 'high' | 'medium' | 'low' | 'insufficient_data'
export type PricingStatus = 'healthy' | 'adjust' | 'opportunity' | 'review' | 'insufficient_data'
export type LossLevel = 'product' | 'category' | 'store' | 'network'
export type VoucherBasis = 'sales_weighted' | 'simple_average' | 'none'

export interface PaymentCostComponent {
  method: PaymentMethod
  share: number
  rateBps: number
}

export interface PaymentCost {
  /** The mix-weighted fee as a fraction of the price. */
  rate: number
  components: PaymentCostComponent[]
  voucherShare: number
  voucherBasis: VoucherBasis
  /** Share of sales whose method or rate could not be resolved — priced at the average of the rest. */
  unresolvedShare: number
  complete: boolean
  notes: string[]
}

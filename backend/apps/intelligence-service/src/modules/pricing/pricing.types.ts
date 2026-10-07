/**
 * Recorded on every result and stored run so a number can be reproduced. pricing-4: the margin the target applies to is the CONTRIBUTION margin (price minus
 * cost with loss, tax, payment fees, per-sale costs and the percentage-of-sales expenses); every DRE account is classified by how it behaves, per-visit,
 * fixed and other-activity costs leave the price, and the results say whether the classification is complete. pricing-3 adds coverage, pending reasons and the newer-cost flag to the report (the formulas are unchanged). pricing-2: the confidence rubric reads the real origin of the cost
 * (invoice-backed or not), and results carry `costOrigin` and `newProduct`; the price solved from a cost structure is unchanged.
 */
export const ENGINE_VERSION = 'pricing-4'

export const PAYMENT_METHODS = ['pix', 'debit', 'credit', 'voucher'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const ANALYSIS_ONLY_STATEMENT = 'Rateio operacional utilizado exclusivamente para análise de preço. Não representa novo lançamento financeiro.'

/**
 * How a DRE account behaves against the price of ONE product. Only `percent_of_sales` and `per_transaction` are part of the price (the contribution margin);
 * `per_visit`, `fixed` and `other_revenue_cost` belong to the viability of the operation; `already_component` is carried directly (tax, payment fees, loss,
 * purchases) and must never come in again through the allocation.
 */
export const OPERATING_CLASSES = ['percent_of_sales', 'per_transaction', 'per_visit', 'fixed', 'other_revenue_cost', 'already_component'] as const
export type OperatingClass = (typeof OPERATING_CLASSES)[number]

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
  operating: {
    /** DRE account code → class. An account of the price-relevant sections that is not here is UNCLASSIFIED: listed, outside the price, and the result is marked not validated. */
    accountBehavior: Record<string, OperatingClass>
    /** Unclassified expenses above this share of store revenue (basis points) make the calculation incomplete and every recommendation not validated. */
    unclassifiedRelevantBps: number
  }
  payment: {
    /**
     * Names the sales report uses mapped to the name the fee is registered
     * under, folded (lower case, no accents or spaces). Sodexo is the former
     * name of Pluxee and PagSeguro is PagBank; sales still use the old names
     * (owner decisions 2026-10-06).
     */
    brandAliases: Record<string, string>
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
  /** Fixed fees per sold unit, in centavos (e.g. Ticket R$ 0,89 per sale, spread over the units sold). */
  fixedPerUnitCents: number
  voucherShare: number
  voucherBasis: VoucherBasis
  /** Share of sales whose method or rate could not be resolved — priced at the average of the rest. */
  unresolvedShare: number
  complete: boolean
  notes: string[]
}

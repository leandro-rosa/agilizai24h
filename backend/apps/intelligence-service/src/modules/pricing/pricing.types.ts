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
    /** Receipt lines a payment mix (of a product, of its category, of the network) needs before it is trusted to weigh the fees. Fewer: the next level is tried; none reliable: no recommendation. */
    minMixReceiptLines: number
    /** Share of the receipt lines (basis points) that must carry a purchase identifier for the missing ones to be ESTIMATED from them. Below it the tickets are unknown and the fixed fee is not distributed. */
    minIdentifiedTicketShareBps: number
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

/** How the fixed payment fee reached the per-unit figure. The total is ALWAYS an estimate (registered fee × counted tickets), never what the acquirers charged. */
export interface PaymentFixedFee {
  estimatedTotalCents: number
  tickets: number
  units: number
  lines: number
  /** Lines with no purchase identifier at all (no coupon, transaction code or acquirer code): they cannot be grouped, so they are ESTIMATED, never taken as a ticket each. */
  linesWithoutTicketId: number
  /** `identified`: every ticket observed (by coupon, transaction code or acquirer code). `estimated`: the lines without an identifier were estimated from the ones that have it. `unknown_tickets`: too few lines carry an identifier to estimate, so the fixed fee was not distributed. `unknown_units`: the sales service gave no units. */
  basis: 'identified' | 'estimated' | 'unknown_tickets' | 'unknown_units'
  note: string
}

export type MixLevel = 'product' | 'category' | 'network'

/** How the VR/VA fee was reached: which brands, at which rates and shares, over how many receipt lines, and by which method. */
export interface VoucherDetail {
  /** The effective VR/VA rate, in basis points (fractional: it is an average); null when no voucher brand has a registered rate. */
  rateBps: number | null
  /** The same average over the brands' fixed fee per sale, in centavos. */
  fixedCents: number
  /** `sales_weighted`: brands weighted by their share of the voucher sales. `simple_average`: plain average (too few voucher lines to weight). `none`: no voucher rate registered. */
  basis: VoucherBasis
  /** Receipt lines of voucher sales behind the calculation (the volume the choice between weighted and simple depends on), and the minimum needed to weight. */
  receiptLines: number
  minReceiptLines: number
  brands: { brand: string; rateBps: number; fixedCents: number; share: number }[]
  /** Brands with voucher sales and no registered rate: reported, never priced as 0%. */
  missingRateBrands: string[]
}

export interface PaymentCost {
  /** Whose payment mix weighed the fees: the product's own, its category's or the network's. Set by the engine when it chooses; absent in a report stored before pricing-4. */
  level?: MixLevel
  /** Receipt lines of the mix that was used (the evidence behind `level`). */
  mixLines?: number
  /** The mix-weighted fee as a fraction of the price. */
  rate: number
  components: PaymentCostComponent[]
  /** The fixed fee of each sale (e.g. Ticket R$ 0,89) spread over the UNITS sold, in centavos per unit: the share of one unit, not the whole fee of a ticket. */
  fixedPerUnitCents: number
  /** How that figure was built and how firm it is. Absent in a report stored before pricing-4, which divided the fee by receipt lines. */
  fixed?: PaymentFixedFee
  voucherShare: number
  voucherBasis: VoucherBasis
  /** The VR/VA calculation in detail (brands, effective rate, method, volume). Absent in a report stored before this field. */
  voucher?: VoucherDetail
  /** Share of sales whose method or rate could not be resolved — priced at the average of the rest. */
  unresolvedShare: number
  complete: boolean
  notes: string[]
}

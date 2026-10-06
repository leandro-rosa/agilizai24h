/**
 * Response contract of the supplier / product analysis.
 *
 * A figure is never a bare number: it is either available or says WHY it is not,
 * so a consumer cannot render a missing figure as 0 (the same rule as the
 * partitioned cost result in products-service).
 */
export type UnavailableReason = 'no_purchase_history' | 'never_ingested' | 'no_cost' | 'no_base'

export type Figure =
  | { available: true; value: number; /** Some stores/months behind this value are known to be incomplete. */ partial?: boolean }
  | { available: false; reason: UnavailableReason }

export type CompareTo = 'prev_month' | 'avg_3m'

export type SituationLabel = 'good' | 'attention' | 'critical'
export type InsightLabel = 'FATO' | 'MÉTRICA DERIVADA' | 'ESTIMATIVA'

/** The movement of a set of SKUs (a supplier, a product, a store × product) in one month. */
export interface Movement {
  purchasedUnits: Figure
  purchasedCents: Figure
  restocked: Figure
  sold: Figure
  lost: Figure
  revenueCents: Figure
  lossCents: Figure
  /** Revenue minus cost of what was sold, over revenue. Unavailable when a sold SKU has no cost. */
  marginShare: Figure
  /** Average unit cost of the SKUs, weighted by units sold. */
  avgCostCents: Figure
}

export interface Variation {
  /** Value of the comparison period (previous month, or the mean of the 3 previous months). */
  reference: Figure
  /** Relative change, e.g. 0.18 = +18%. Unavailable when either side is. */
  change: Figure
}

export interface MovementWithComparison {
  current: Movement
  comparison: Record<keyof Movement, Variation>
}

export interface Insight {
  kind: string
  label: InsightLabel
  tone: 'positive' | 'attention' | 'critical' | 'info'
  text: string
  /** What originated the insight: every number it used and, for a ratio, its numerator and denominator. */
  evidence: { figures: Record<string, number>; formula?: string; reference?: string }
}

export interface StoreRow {
  storeId: number
  storeName: string | null
  restocked: number
  sold: number
  lost: number
  sellThrough: number | null
  situation: SituationLabel | null
  /** Why `situation` is null, when it is. */
  situationReason?: 'below_min_restocked'
}

export interface MonthlyPoint {
  month: string
  purchasedUnits: Figure
  restocked: Figure
  sold: Figure
  lost: Figure
}

export interface DataQuality {
  /** Months in the window with at least one store whose supply or sales was never ingested. */
  monthsWithGaps: { month: string; storesMissingSupply: number; storesMissingSales: number }[]
  /** The purchase base is not available before this month, if known. */
  purchaseBaseFrom: string | null
}

export interface ProductLine {
  sku: string
  name: string
  supplierId: number | null
  movement: Movement
  comparison: Record<keyof Movement, Variation>
}

export interface AnalysisMeta {
  period: string
  compareTo: CompareTo
  parameterVersion: number
  dataQuality: DataQuality
}

export interface SupplierAnalysis {
  meta: AnalysisMeta
  supplierId: number
  totals: MovementWithComparison
  products: ProductLine[]
  /** Share of the supplier's revenue by SKU, largest first. */
  evolution: MonthlyPoint[]
  insights: Insight[]
}

export interface ProductAnalysis {
  meta: AnalysisMeta
  product: { sku: string; name: string; supplierId: number | null }
  totals: MovementWithComparison
  stores: StoreRow[]
  evolution: MonthlyPoint[]
  insights: Insight[]
}

export interface CrossAnalysis {
  meta: AnalysisMeta
  supplierId: number
  product: { sku: string; name: string; declaredSupplierId: number | null }
  /** True only when the product is linked to exactly this supplier. */
  linked: boolean
  totals: MovementWithComparison | null
  /** Suppliers compared side by side; needs purchase history, so it is empty (with the reason) until then. */
  suppliers: { supplierId: number; movement: Movement }[]
  suppliersUnavailableReason: UnavailableReason | null
}

/**
 * Shared shapes of the commercial-intelligence engine.
 *
 * The engine is a set of pure functions: no React, no fetching, no storage.
 * Everything here is a plain type (no enums, no namespaces) so that a bare
 * Node can strip it and run the functions for verification, and every
 * cross-module import is either relative or `import type`.
 */

/**
 * How a number was obtained — the label the page prints next to it.
 *  - `fact`: recorded as it is (a sale, a stored cost).
 *  - `derived`: computed from facts with no assumption (a ratio, a sum).
 *  - `assumption`: a value somebody typed in (the minimum margin, the capture range).
 *  - `estimate`: a projection that depends on an assumption.
 * `fact` and `derived` read as "Observado"; `assumption` and `estimate` as "Estimado".
 */
export type Provenance = "fact" | "derived" | "assumption" | "estimate";

export type Level = "high" | "medium" | "low" | "insufficient";

/** A quantity known only within bounds, `low <= high`. */
export interface Range {
  low: number;
  high: number;
}

/** What the page is looking at: the whole network or one store. */
export type Scope = { kind: "network" } | { kind: "store"; storeId: number };

export type ConfidenceFactorKey =
  | "evidence"
  | "days"
  | "months"
  | "stability"
  | "peers"
  | "coupon"
  | "cost"
  | "reconciliation";

/** One line of the confidence rubric: what it earned out of what it could have. */
export interface ConfidenceFactor {
  key: ConfidenceFactorKey;
  label: string;
  earned: number;
  max: number;
  /** Plain-language reason, with the number that decided it. */
  detail: string;
}

/** A hard ceiling on the level, listed to the reader, whatever the score says. */
export interface ConfidenceCap {
  /** The highest level the cap allows. */
  ceiling: "medium" | "low";
  reason: string;
}

export interface Confidence {
  level: Level;
  /** 0–100, or null when the evidence is below its minimum and no score was computed. */
  score: number | null;
  factors: ConfidenceFactor[];
  caps: ConfidenceCap[];
  /** Set only when `level` is `insufficient`: the full sentence to show. */
  insufficient: string | null;
  /** Claims the rubric forbids (for example margin figures when costs barely resolve). */
  withheld: string[];
}

/** One fact behind a recommendation, with its label. */
export interface EvidenceFact {
  label: string;
  value: string;
  provenance: Provenance;
}

export type Priority = "high" | "medium" | "low";
export type Objective = "ticket" | "margin" | "test";

/** The value of one parameter at the moment a recommendation was produced. */
export interface ParameterUsage {
  path: string;
  value: number;
}

/** Where a recommendation comes from, so it can be audited and understood (design D20). */
export type Origin = "baskets" | "product" | "time" | "similar_store" | "loss" | "margin" | "mix";

/** An observation is an insight; only a rule that links it to a testable action makes a recommendation. */
export type FindingKind = "insight" | "recommendation";

/** The three scenarios of an impact estimate, in R$ of margin per month: premises of potential, never measured or guaranteed. */
export interface ImpactScenarios {
  conservativeCents: number;
  expectedCents: number;
  optimisticCents: number;
  /** The premise the scenarios rest on, said in words. */
  assumption: string;
}

/** The effort of an action, and the risk it carries for margin or loss: two of the four things that rank an opportunity. */
export type Effort = "low" | "medium" | "high";
export type Risk = "none" | "margin" | "loss";

/**
 * A recommendation or an insight. Type only for now: the detectors that produce
 * it are held until the calibration of real data (tasks group 5), and this
 * shape may change with them.
 */
export interface Opportunity {
  id: string;
  kind: FindingKind;
  /** The detectors that support it: several detectors describing one cause become one opportunity. */
  detectors: string[];
  origin: Origin;
  objective: Objective;
  priority: Priority;
  title: string;
  storeId: number | null;
  evidence: EvidenceFact[];
  interpretation: string;
  /** Null when no reference gap can be observed: "impacto não estimável", never a number. */
  impact: ImpactScenarios | null;
  effort: Effort;
  risk: Risk;
  recommendation: string | null;
  confidence: Confidence;
  /** What it was compared against: the store's own history, similar stores or, secondarily, the network. */
  benchmark: { kind: "own_history" | "similar_stores" | "network"; storeIds: number[] };
  /** The period and the sample the conclusion rests on, so it can be explained. */
  period: string;
  sampleSize: number;
  limitations: string[];
  /** The version of the analytic logic that produced it (D22). */
  logicVersion: string;
  /** The parameter values in force when it was produced (D22). */
  parameters: ParameterUsage[];
}

/** "Sunday" is 0, as `Date#getUTCDay` reports it. */
export interface WallClock {
  /** `YYYY-MM-DD` in the store's local clock. */
  date: string;
  day: number;
  hour: number;
  weekday: number;
  /** Milliseconds of the wall clock read as if it were UTC — only for spans and ordering. */
  ms: number;
}

/** A line's price state: whether it was sold with a discount, and how sure we are. */
export type PriceState = "full" | "discounted" | "unknown";

/** One completed sale line, reduced to what the analyses read. */
export interface DatasetLine {
  storeId: number;
  sku: string;
  quantity: number;
  paidCents: number;
  originalCents: number | null;
  discountCents: number | null;
  /** Trimmed and non-empty, or null. */
  coupon: string | null;
  wall: WallClock | null;
  priceState: PriceState;
  posId: string | null;
  machineModel: string | null;
}

/**
 * A purchase rebuilt from a coupon: the lines of one store sharing it. A coupon
 * whose lines are spread over too long a span is a reused coupon, not a
 * purchase: it is counted on the store's aggregate and never appears here.
 */
export interface CouponBasket {
  key: string;
  storeId: number;
  lines: DatasetLine[];
  /** Distinct SKUs, in first-seen order. */
  skus: string[];
  totalCents: number;
  /** Minutes between the first and the last dated line; 0 with fewer than two dated lines. */
  spanMinutes: number;
  /** More distinct SKUs than pair counting tolerates. */
  oversized: boolean;
}

export interface StoreAggregate {
  storeId: number;
  okLines: number;
  couponLines: number;
  revenueCents: number;
  couponRevenueCents: number;
  /** Lines with no coupon: never turned into baskets for association. */
  orphanLines: number;
  /** Coupon baskets kept for association (not reused). */
  couponBaskets: number;
  /** Coupon baskets with two or more distinct SKUs. */
  multiItemBaskets: number;
  /** Coupon baskets dropped because their lines spanned too long. */
  reusedBaskets: number;
  reusedLines: number;
  /** Coupon baskets skipped for pair counting for having too many SKUs. */
  oversizedBaskets: number;
  /** Local dates (`YYYY-MM-DD`) with at least one line. */
  sellingDays: Set<string>;
  /** Lines with no readable timestamp. */
  undatedLines: number;
}

export interface SkuAggregate {
  sku: string;
  units: number;
  revenueCents: number;
  lines: number;
  sellingDays: Set<string>;
}

export interface Dataset {
  lines: DatasetLine[];
  baskets: CouponBasket[];
  stores: Map<number, StoreAggregate>;
  /** Store → SKU → aggregate. */
  skus: Map<number, Map<string, SkuAggregate>>;
}

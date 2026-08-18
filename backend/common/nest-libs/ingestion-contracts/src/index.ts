/**
 * Queue contracts between ingestion-worker-service and the services that
 * persist what it parses.
 *
 * One queue per file type rather than a generic "parse anything" queue: the
 * three operational spreadsheets share no schema, so a union payload would be
 * re-checked by every consumer and a malformed sales file would retry in the
 * same queue as a cost sheet.
 *
 * Queue-envelope fields are camelCase, matching the inter-service convention —
 * persisted and HTTP fields are snake_case. The translation happens in the
 * producer, deliberately, rather than letting one convention leak into the
 * other's territory.
 */

export const INGESTION_QUEUES = {
  SALES_ROWS: 'ingestion.sales-rows',
  SUPPLY_ROWS: 'ingestion.supply-rows',
  COST_ROWS: 'ingestion.cost-rows',
} as const

export type IngestionQueueName = (typeof INGESTION_QUEUES)[keyof typeof INGESTION_QUEUES]

/**
 * Every ingestion job carries the same envelope. `schemaVersion` exists so a
 * consumer can reject a payload it does not understand instead of silently
 * mis-reading fields when the shape changes.
 */
export interface IngestionEnvelope<T> {
  schemaVersion: 1
  /** The ingestion this batch belongs to — the provenance stored on each row. */
  ingestionId: string
  /** Traces one operator upload across every service it touches. */
  correlationId?: string
  /** Internal store id, already resolved from the file's external code. */
  storeId: number
  /** The month being ingested, as YYYY-MM. */
  period: string
  rows: T[]
}

export interface SalesRow {
  sku: string
  quantitySold: number
  /** Integer minor units (centavos). Never a float. */
  revenueCents: number
}

export type SalesRowsJob = IngestionEnvelope<SalesRow>

export interface SupplyRestockRow {
  sku: string
  quantityRestocked: number
}

/**
 * Removals arrive ALREADY SPLIT per reason. supply-service never parses the
 * free-text "Removals" field — that interpretation belongs to the parser,
 * because the text format is the POS platform's and may change, while the loss
 * classification is the business's and is stable.
 */
export interface SupplyRemovalRow {
  sku: string
  reason: string
  quantityRemoved: number
  /** Kept for audit: what the file actually said on that line. */
  sourceText?: string
}

export type SupplyRowsJob = IngestionEnvelope<never> & {
  restocks: SupplyRestockRow[]
  removals: SupplyRemovalRow[]
}

export interface CostRow {
  sku: string
  costCents: number
  /** ISO date the cost takes effect — the period stated at upload. */
  effectiveFrom: string
}

export type CostRowsJob = IngestionEnvelope<CostRow>

/** Period strings are YYYY-MM; validated at the boundary so a malformed one fails loudly. */
export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isValidPeriod(period: string): boolean {
  return PERIOD_PATTERN.test(period)
}

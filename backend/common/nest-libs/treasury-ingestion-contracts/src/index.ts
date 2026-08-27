/**
 * Queue contract between ingestion-worker-service (producer, one parser per
 * source) and treasury-service (sole consumer, owns classification and
 * staging). One outbound queue, not one per source: unlike sales/supply/cost
 * — which fan out to three different sinks — every treasury source funnels
 * into the same sink, so a per-source queue would only exist to be merged
 * again on the other side.
 *
 * Queue-envelope fields are camelCase, matching the inter-service convention
 * — persisted and HTTP fields are snake_case. The translation happens in the
 * producer, deliberately, rather than letting one convention leak into the
 * other's territory.
 */

export const TREASURY_QUEUES = {
  RAW_ROWS: 'treasury.raw-rows',
} as const

export type TreasuryQueueName = (typeof TREASURY_QUEUES)[keyof typeof TREASURY_QUEUES]

/**
 * The seven monthly sources, each with its own parser and its own inbound
 * queue on ingestion-worker-service. `pagseguro_invoice` (the PagBank/
 * PagSeguro card invoice) was added after the original six were validated
 * against real files (design.md D11) — it is a genuinely distinct file from
 * `pagbank_statement` (the checking-account extrato), with its own inverted
 * line shape and its own `BankAccount`.
 */
export const TREASURY_SOURCES = [
  'pagbank_statement',
  'c6_statement',
  'c6_invoice',
  'pagseguro_invoice',
  'nubank_statement',
  'bradesco_statement',
  'itau_statement',
] as const

export type TreasurySource = (typeof TREASURY_SOURCES)[number]

/** ingestion-worker-service's own inbound queue per source — never consumed outside that service. */
export const TREASURY_SOURCE_QUEUES: Record<TreasurySource, string> = {
  pagbank_statement: 'treasury-ingestion.pagbank-statement',
  c6_statement: 'treasury-ingestion.c6-statement',
  c6_invoice: 'treasury-ingestion.c6-invoice',
  pagseguro_invoice: 'treasury-ingestion.pagseguro-invoice',
  nubank_statement: 'treasury-ingestion.nubank-statement',
  bradesco_statement: 'treasury-ingestion.bradesco-statement',
  itau_statement: 'treasury-ingestion.itau-statement',
}

/**
 * A single parsed line, before classification. `treasury-service` runs this
 * through the mapping-rule engine on arrival (add-treasury-classification-
 * model) — the parser never resolves a fornecedor or a `nature`.
 */
export interface TreasuryRawRow {
  /** ISO date, "YYYY-MM-DD". */
  occurredOn: string
  /** Always positive — the sign lives in `direction`, same convention as `BankTransaction`. */
  amountCents: number
  direction: 'inflow' | 'outflow'
  /** As it appears in the source — normalized later, never here. */
  counterpartyRaw: string
  /** Line/page reference into the original file, for tracing a figure back to its evidence. */
  sourceRef?: string
  installmentIndex?: number
  installmentTotal?: number
  /**
   * Set only when the FILE's own structure already determines the
   * classification — a fatura's "Inclusão de Pagamento" section, a
   * "Refinanciamento Fatura" line, or an Itaú SISPAG line whose statement
   * carries no payee at all — never from matching the counterparty text.
   * When present, treasury-service uses it instead of running mapping
   * resolution for this row (design: add-treasury-statement-ingestion,
   * task 3.6). `kind: 'pending'` is the explicit "do not even try to
   * resolve this" signal (the SISPAG case — see spec "Itaú SISPAG lines are
   * staged as pending"). Absent for an ordinary line, which is resolved
   * normally.
   */
  structuralHint?: {
    kind: 'movement' | 'expense' | 'pending'
    category?: string
  }
}

export interface TreasuryRawRejection {
  /** Page/line reference into the original file — enough for an operator to find it. */
  rowReference: string
  reason: string
  detail: string
}

/**
 * One job per uploaded file. Never split into smaller batches: a monthly
 * statement is hundreds of lines, not thousands, so there is no chunking
 * failure mode here the way there is for the sales/supply workbooks — see
 * add-treasury-statement-ingestion design, Goals.
 */
export interface TreasuryRawRowsJob {
  schemaVersion: 1
  correlationId?: string
  source: TreasurySource
  /** Which `BankAccount` these rows belong to — stated by the uploader, never guessed from the file. */
  accountId: number
  /** The month being imported, as YYYY-MM. */
  period: string
  /** Where the raw file lives in object storage — the evidence, kept even after parsing. */
  objectKey: string
  rows: TreasuryRawRow[]
  rejections: TreasuryRawRejection[]
}

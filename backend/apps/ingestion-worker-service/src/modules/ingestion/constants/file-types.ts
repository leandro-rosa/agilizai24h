/** The three operational spreadsheets, each with its own parser and contract. */
export const INGESTION_FILE_TYPES = ['sales', 'supply', 'cost'] as const
export type IngestionFileType = (typeof INGESTION_FILE_TYPES)[number]

export const INGESTION_STATUSES = [
  'accepted',
  'processing',
  'completed',
  'partially_completed',
  'failed',
] as const
export type IngestionStatus = (typeof INGESTION_STATUSES)[number]

/** Queue this service uses internally, between file-parsing and row-staging. */
export const INTERNAL_QUEUES = {
  PARSE_FILE: 'ingestion.parse-file',
  STAGED_ROWS: 'ingestion.staged-rows',
} as const

/**
 * Column headers each file type must carry, checked before chunking so a
 * structural mismatch fails once rather than once per row.
 *
 * Compared after the same folding used for names: case, accents, whitespace.
 *
 * `supply` (the restocking workbook) is unused here: its structure — a
 * multi-sheet, two-table-per-sheet layout — is validated by
 * `locateRestockingOperations`, per sheet, rather than by a single row-1
 * header check. Kept as a key only so this stays a total map over
 * `IngestionFileType`.
 */
export const REQUIRED_HEADERS: Record<IngestionFileType, string[]> = {
  sales: ['Descrição / Nome produto', 'Qtd. vendida', 'Valor Vendido'],
  supply: [],
  cost: ['Produto', 'Custo'],
}

/**
 * Retry policy for every job this service publishes.
 *
 * @app/hold-it's defaults set `attempts: 0`, meaning a job is tried once and
 * dropped. Parsing depends on object storage and two HTTP services, so a
 * transient blip would silently discard an upload. Bounded at three, because a
 * genuinely malformed file must reach a terminal failure — visible through
 * hold-it's failed-job endpoint — rather than retry forever.
 */
export const RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
}

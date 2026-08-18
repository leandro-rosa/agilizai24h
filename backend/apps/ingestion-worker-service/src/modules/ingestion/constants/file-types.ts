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
 */
export const REQUIRED_HEADERS: Record<IngestionFileType, string[]> = {
  sales: ['produto', 'quantidade', 'valor'],
  supply: ['produto', 'abastecido'],
  cost: ['produto', 'custo'],
}

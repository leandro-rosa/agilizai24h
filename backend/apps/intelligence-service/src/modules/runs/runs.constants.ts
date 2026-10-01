/** One job per store; the run is finished when every store has reported. */
export const INTELLIGENCE_QUEUES = {
  ENGINE_STORE: 'intelligence.engine-store',
} as const

/** Bounded retries: a transient read failure gets another try, a real defect reaches a terminal failure. */
export const RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
}

export interface EngineStoreJob {
  schemaVersion: 1
  runId: string
  storeId: number
  correlationId?: string
}

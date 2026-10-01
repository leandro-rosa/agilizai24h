/** One job per backtest: the replay is one coherent computation over every store and origin. */
export const BACKTEST_QUEUES = {
  BACKTEST: 'intelligence.backtest',
} as const

/** Bounded retries: a transient read failure gets another try, a real defect reaches a terminal `failed`. */
export const BACKTEST_RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
}

export interface BacktestJob {
  schemaVersion: 1
  backtestId: string
  correlationId?: string
}

/**
 * The contract between the monthly refresh (group 9) and the backtest (group 8),
 * fixed up front so the two can be built in parallel. The refresh depends only on
 * this port; the backtest module provides the real implementation under
 * `BACKTEST_PORT`, and the refresh's tests use a stub.
 */
export const BACKTEST_PORT = Symbol('BACKTEST_PORT')

export type BacktestStatus = 'running' | 'completed' | 'failed'

export interface BacktestStartInput {
  /** The history the backtest may read, YYYY-MM. */
  rangeFrom: string
  rangeTo: string
  /** The last month the data really covers; origins never go beyond it. */
  dataThrough: string
  /** Reference instant for balance ages (the end of `dataThrough`, so that month counts as ended). */
  asOf: Date
  parameterVersionId: number
  correlationId?: string
}

export interface BacktestPort {
  /**
   * Starts a backtest (through the queue, never inside the caller) and returns its id at once.
   * Origins are every month start from the first one with at least eight weeks of history
   * through `dataThrough`; the report covers coverage and the count-rule sensitivity too.
   */
  start(input: BacktestStartInput): Promise<{ id: string }>

  /** Where a started backtest stands. `completed` means its stored report is final. */
  status(id: string): Promise<BacktestStatus>
}

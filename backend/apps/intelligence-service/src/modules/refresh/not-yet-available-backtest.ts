import type { BacktestPort, BacktestStartInput, BacktestStatus } from './refresh.ports'

const MESSAGE = 'The backtest is not wired into this build yet: import the backtest module so that it provides BACKTEST_PORT'

/**
 * PLACEHOLDER for `BACKTEST_PORT` until the backtest module (group 8) provides the real one.
 * Failing loudly is deliberate: a refresh that cannot run its backtest must FAIL (leaving the
 * previous current set in place), never pretend a set is complete without it.
 */
export class NotYetAvailableBacktest implements BacktestPort {
  start(_input: BacktestStartInput): Promise<{ id: string }> {
    return Promise.reject(new Error(MESSAGE))
  }

  status(_id: string): Promise<BacktestStatus> {
    return Promise.reject(new Error(MESSAGE))
  }
}

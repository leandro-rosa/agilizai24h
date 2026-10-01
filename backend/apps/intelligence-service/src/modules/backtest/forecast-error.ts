import type { Interval } from '../engine/intervals'

/**
 * One Product x Store at one origin: the consumption the engine predicted for the
 * period (median daily rate x days of the intervals that ended in it) against the
 * consumption observed between visits. Censored intervals (shelf emptied) only give
 * a lower bound of demand, so they are counted APART and left out of the error;
 * so are rises (a data conflict) and stretches with no stock.
 */
export interface ForecastObservation {
  predictedUnits: number
  observedUnits: number
  absoluteError: number
  /** Uncensored intervals that entered the error. */
  intervals: number
  observedDays: number
  censoredIntervals: number
  /** Units consumed in the censored intervals — a lower bound of demand, never in the error. */
  censoredLowerBoundUnits: number
  excludedConflicts: number
}

export function forecastObservation(rateMid: number | null, intervals: Interval[]): ForecastObservation | null {
  if (rateMid === null) return null

  const usable = intervals.filter(interval => !interval.censored && !interval.noStock && !interval.rise && interval.days > 0)
  const censored = intervals.filter(interval => interval.censored)
  const observedUnits = usable.reduce((total, interval) => total + interval.consumption, 0)
  const observedDays = usable.reduce((total, interval) => total + interval.days, 0)
  const predictedUnits = rateMid * observedDays

  return {
    predictedUnits,
    observedUnits,
    absoluteError: Math.abs(predictedUnits - observedUnits),
    intervals: usable.length,
    observedDays,
    censoredIntervals: censored.length,
    censoredLowerBoundUnits: censored.reduce((total, interval) => total + interval.consumption, 0),
    excludedConflicts: intervals.filter(interval => interval.rise).length,
  }
}

export interface ForecastError {
  /** Pairs that had a forecast AND at least one uncensored observation: the ones the error rests on. */
  pairs: number
  predictedUnits: number
  observedUnits: number
  absoluteError: number
  /**
   * THE error metric: weighted absolute percentage error = sum |predicted - observed| / sum observed,
   * over uncensored observations. Null when nothing was observed. Not a pass mark.
   */
  wape: number | null
  censoredIntervals: number
  censoredLowerBoundUnits: number
  /** Pairs with no forecast (no uncensored demand at the origin) or with no uncensored observation afterwards. */
  pairsWithoutForecast: number
  pairsWithoutObservation: number
}

export function aggregateForecastError(observations: (ForecastObservation | null)[]): ForecastError {
  const withForecast = observations.filter((o): o is ForecastObservation => o !== null)
  const used = withForecast.filter(o => o.intervals > 0)
  const observedUnits = used.reduce((t, o) => t + o.observedUnits, 0)
  const absoluteError = used.reduce((t, o) => t + o.absoluteError, 0)

  return {
    pairs: used.length,
    predictedUnits: used.reduce((t, o) => t + o.predictedUnits, 0),
    observedUnits,
    absoluteError,
    wape: observedUnits > 0 ? absoluteError / observedUnits : null,
    censoredIntervals: withForecast.reduce((t, o) => t + o.censoredIntervals, 0),
    censoredLowerBoundUnits: withForecast.reduce((t, o) => t + o.censoredLowerBoundUnits, 0),
    pairsWithoutForecast: observations.length - withForecast.length,
    pairsWithoutObservation: withForecast.length - used.length,
  }
}

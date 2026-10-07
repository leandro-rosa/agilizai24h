import { PAYMENT_METHODS, type PaymentMethod } from '../constants/treasury-vocabulary'

export interface FeeRow {
  acquirer: string
  payment_method: string
  rate_bps: number
  effective_from: Date
}

export interface RateInForce {
  acquirer: string
  payment_method: PaymentMethod
  rate_bps: number
  /** 'YYYY-MM-DD' */
  effective_from: string
}

export interface RatesInForce {
  /** 'YYYY-MM-DD' */
  on: string
  rates: RateInForce[]
  /** Methods with no rate registered on `on`. Reported, never returned as 0%. */
  methods_without_rate: PaymentMethod[]
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10)

/**
 * For each (acquirer, method) the most recent rate whose effective date is on
 * or before `on`. A method with no rate on that date is listed in
 * `methods_without_rate`; there is no zero default.
 */
export function ratesInForce(fees: FeeRow[], on: string): RatesInForce {
  const latest = new Map<string, FeeRow>()

  for (const fee of fees) {
    if (isoDay(fee.effective_from) > on) continue

    const key = `${fee.acquirer}\u0000${fee.payment_method}`
    const current = latest.get(key)
    if (!current || fee.effective_from > current.effective_from) latest.set(key, fee)
  }

  const known = new Set<string>(PAYMENT_METHODS)
  const rates = [...latest.values()]
    .filter((fee): fee is FeeRow & { payment_method: PaymentMethod } => known.has(fee.payment_method))
    .map((fee) => ({
      acquirer: fee.acquirer,
      payment_method: fee.payment_method,
      rate_bps: fee.rate_bps,
      effective_from: isoDay(fee.effective_from),
    }))
    .sort((a, b) => a.acquirer.localeCompare(b.acquirer) || a.payment_method.localeCompare(b.payment_method))

  const covered = new Set(rates.map((rate) => rate.payment_method))

  return { on, rates, methods_without_rate: PAYMENT_METHODS.filter((method) => !covered.has(method)) }
}

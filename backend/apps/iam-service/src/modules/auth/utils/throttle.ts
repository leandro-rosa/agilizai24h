/**
 * Pure throttle arithmetic, kept out of the service so the boundary conditions
 * can be tested without a database.
 */
export interface ThrottleState {
  failed_attempts: number
  throttled_until: Date | null
}

export function isThrottled(state: ThrottleState, now: Date): boolean {
  return state.throttled_until !== null && state.throttled_until.getTime() > now.getTime()
}

/**
 * Returns the state to persist after a failed attempt. Once the threshold is
 * reached the account is locked for a fixed window; the window always expires
 * on its own, so throttling can never become a permanent lockout needing an
 * administrator.
 */
export function nextStateAfterFailure(
  state: ThrottleState,
  now: Date,
  maxAttempts: number,
  throttleSeconds: number,
): ThrottleState {
  const failed = state.failed_attempts + 1

  if (failed >= maxAttempts) {
    return { failed_attempts: failed, throttled_until: new Date(now.getTime() + throttleSeconds * 1000) }
  }

  return { failed_attempts: failed, throttled_until: null }
}

/** A successful authentication clears the counter entirely. */
export function clearedState(): ThrottleState {
  return { failed_attempts: 0, throttled_until: null }
}

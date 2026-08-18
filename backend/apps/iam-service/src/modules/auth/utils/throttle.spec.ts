import { clearedState, isThrottled, nextStateAfterFailure } from './throttle'

const now = new Date('2026-08-18T12:00:00Z')

describe('isThrottled', () => {
  it('is false when no throttle is set', () => {
    expect(isThrottled({ failed_attempts: 3, throttled_until: null }, now)).toBe(false)
  })

  it('is true while the window is open', () => {
    expect(isThrottled({ failed_attempts: 5, throttled_until: new Date(now.getTime() + 1000) }, now)).toBe(true)
  })

  it('clears on its own once the window passes', () => {
    // The spec requires throttling to never become a permanent lockout.
    expect(isThrottled({ failed_attempts: 5, throttled_until: new Date(now.getTime() - 1) }, now)).toBe(false)
  })
})

describe('nextStateAfterFailure', () => {
  it('counts up without throttling below the threshold', () => {
    const next = nextStateAfterFailure({ failed_attempts: 1, throttled_until: null }, now, 5, 900)

    expect(next).toEqual({ failed_attempts: 2, throttled_until: null })
  })

  it('throttles once the threshold is reached', () => {
    const next = nextStateAfterFailure({ failed_attempts: 4, throttled_until: null }, now, 5, 900)

    expect(next.failed_attempts).toBe(5)
    expect(next.throttled_until).toEqual(new Date(now.getTime() + 900_000))
  })
})

describe('clearedState', () => {
  it('resets the counter on success', () => {
    expect(clearedState()).toEqual({ failed_attempts: 0, throttled_until: null })
  })
})

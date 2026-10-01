import { DEFAULT_PARAMETERS, isProvisional, parameterMeta } from './parameters.defaults'
import { buildParameters, isValidWeekdays, mergeParameters, ParametersInvalidError, validateParameters } from './parameters.validation'

describe('the default parameters', () => {
  it('are valid', () => {
    expect(validateParameters(DEFAULT_PARAMETERS)).toEqual([])
  })

  it("carry the owner's tolerance: 10% or 3 units, whichever is more permissive", () => {
    expect(DEFAULT_PARAMETERS.tolerance.pct).toBe(0.1)
    expect(DEFAULT_PARAMETERS.tolerance.units).toBe(3)
  })

  it('start the count rules at 3 counts, minimum 1, 45 days — provisional', () => {
    expect(DEFAULT_PARAMETERS.tolerance).toMatchObject({ windowCounts: 3, minCounts: 1, maxAgeDays: 45 })
    for (const path of ['tolerance.windowCounts', 'tolerance.minCounts', 'tolerance.maxAgeDays']) expect(isProvisional(path)).toBe(true)
  })

  it('make the owner-specified values non-provisional and everything else provisional', () => {
    expect(isProvisional('tolerance.pct')).toBe(false)
    expect(isProvisional('tolerance.units')).toBe(false)
    expect(isProvisional('schedule.visitWeekdays')).toBe(false)
    expect(isProvisional('demand.halfLifeDays')).toBe(true)
    expect(isProvisional('mix.minExposureCycles')).toBe(true)
  })

  it('visit on Monday, Tuesday, Thursday and Friday', () => {
    expect(DEFAULT_PARAMETERS.schedule.visitWeekdays).toEqual([1, 2, 4, 5])
  })

  it('label every parameter with its provisional flag', () => {
    const meta = parameterMeta(DEFAULT_PARAMETERS)

    expect(meta.find(row => row.path === 'tolerance.pct')).toEqual({ path: 'tolerance.pct', value: 0.1, provisional: false })
    expect(meta.every(row => typeof row.provisional === 'boolean')).toBe(true)
  })
})

describe('validateParameters rejects nonsense', () => {
  const patch = (group: string, change: Record<string, unknown>) => ({
    ...DEFAULT_PARAMETERS,
    [group]: { ...(DEFAULT_PARAMETERS as unknown as Record<string, Record<string, unknown>>)[group], ...change },
  })

  it('a negative value', () => {
    expect(validateParameters(patch('demand', { halfLifeDays: -5 }) as never).join()).toMatch(/halfLifeDays/)
  })

  it('a non-numeric value', () => {
    expect(validateParameters(patch('quantity', { safetyZ: 'high' }) as never).join()).toMatch(/safetyZ must be a number/)
  })

  it('a tolerance percentage above 100%', () => {
    expect(validateParameters(patch('tolerance', { pct: 1.5 }) as never).join()).toMatch(/tolerance.pct/)
  })

  it('a minimum of counts above the window — no balance could ever be verified', () => {
    expect(validateParameters(patch('tolerance', { windowCounts: 2, minCounts: 3 }) as never).join()).toMatch(/minCounts cannot exceed/)
  })

  it('inverted confidence bands, which would make "medium" unreachable', () => {
    expect(validateParameters(patch('confidence', { highIntervals: 3, mediumIntervals: 6 }) as never).join()).toMatch(/highIntervals must exceed/)
  })

  it('a "majority" that is not a majority', () => {
    expect(validateParameters(patch('mix', { networkMajorityShare: 0.3 }) as never).join()).toMatch(/majority/)
  })

  it('reports every problem at once', () => {
    const problems = validateParameters(patch('tolerance', { pct: 2, maxAgeDays: 0 }) as never)

    expect(problems.length).toBeGreaterThanOrEqual(2)
  })
})

describe('visit weekdays', () => {
  it.each([[[1, 2, 4, 5]], [[3, 5]], [[7]]])('accepts %j', days => expect(isValidWeekdays(days)).toBe(true))
  it.each([[[]], [[0]], [[8]], [[1, 1]], [[1.5]], ['mon'], [null]])('rejects %j', days => expect(isValidWeekdays(days)).toBe(false))

  it('a patch with invalid weekdays is rejected', () => {
    expect(() => buildParameters(DEFAULT_PARAMETERS, { schedule: { visitWeekdays: [9] } })).toThrow(ParametersInvalidError)
  })
})

describe('mergeParameters', () => {
  it('overlays a partial change and keeps the rest', () => {
    const merged = mergeParameters(DEFAULT_PARAMETERS, { tolerance: { pct: 0.15, units: 2 } })

    expect(merged.tolerance).toMatchObject({ pct: 0.15, units: 2, windowCounts: 3, maxAgeDays: 45 })
    expect(merged.demand).toEqual(DEFAULT_PARAMETERS.demand)
  })

  it('never mutates the base', () => {
    const before = JSON.stringify(DEFAULT_PARAMETERS)
    mergeParameters(DEFAULT_PARAMETERS, { tolerance: { pct: 0.5 } })

    expect(JSON.stringify(DEFAULT_PARAMETERS)).toBe(before)
  })

  it('replaces an array instead of merging it', () => {
    expect(mergeParameters(DEFAULT_PARAMETERS, { schedule: { visitWeekdays: [3] } }).schedule.visitWeekdays).toEqual([3])
  })

  it('rejects an unknown group and an unknown parameter', () => {
    expect(() => mergeParameters(DEFAULT_PARAMETERS, { nope: { x: 1 } } as never)).toThrow(/unknown group/)
    expect(() => mergeParameters(DEFAULT_PARAMETERS, { tolerance: { nope: 1 } } as never)).toThrow(/unknown parameter/)
  })
})

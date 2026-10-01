import { buildFreshness } from './freshness'
import { FreshnessService } from './freshness.service'

const NOW = new Date('2026-10-05T12:00:00Z')
const COMPUTED = new Date('2026-10-05T09:30:00Z')

describe('buildFreshness', () => {
  it('up to date: states the month and when it was computed, and is not marked out of date', () => {
    const freshness = buildFreshness({ dataThrough: '2026-09', computedAt: COMPUTED, latestAvailable: null, pendingImport: [] })

    expect(freshness).toMatchObject({ dataThrough: '2026-09', computedAt: '2026-10-05T09:30:00.000Z', status: 'up_to_date', outOfDate: false, monthsLagged: 0, latestAvailableMonth: '2026-09' })
  })

  it('a closed month not yet incorporated: out of date by the number of months it lags', () => {
    const one = buildFreshness({ dataThrough: '2026-08', computedAt: COMPUTED, latestAvailable: '2026-09', pendingImport: [] })
    const three = buildFreshness({ dataThrough: '2026-06', computedAt: COMPUTED, latestAvailable: '2026-09', pendingImport: [] })

    expect(one).toMatchObject({ dataThrough: '2026-08', status: 'out_of_date', outOfDate: true, monthsLagged: 1, latestAvailableMonth: '2026-09' })
    expect(three).toMatchObject({ dataThrough: '2026-06', outOfDate: true, monthsLagged: 3 })
  })

  it('a month not yet imported is reported as pending and never claimed as covered', () => {
    const pending = [{ month: '2026-09', ended: true, activeStores: 10, importedStores: 4, share: 0.4, requiredShare: 0.9, available: false }]
    const freshness = buildFreshness({ dataThrough: '2026-08', computedAt: COMPUTED, latestAvailable: null, pendingImport: pending })

    expect(freshness.dataThrough).toBe('2026-08')
    expect(freshness).toMatchObject({ status: 'up_to_date', outOfDate: false })
    expect(freshness.pendingImport).toEqual([{ month: '2026-09', importedStores: 4, activeStores: 10, share: 0.4, requiredShare: 0.9 }])
  })

  it('nothing computed is not_computed: no month, no computation time, not "up to date"', () => {
    expect(buildFreshness({ dataThrough: null, computedAt: null, latestAvailable: '2026-09', pendingImport: [] })).toMatchObject({ dataThrough: null, computedAt: null, status: 'not_computed', outOfDate: null })
  })
})

describe('FreshnessService — compares an analysis with what the platform holds now', () => {
  const NAMES = [
    { id: 1, name: 'Loja A' },
    { id: 2, name: 'Loja B' },
    { id: 3, name: 'Loja [TESTE]' },
  ]

  /** `imported[store]` = months for which both supply and sales exist. */
  function service(imported: Record<number, string[]>, failing = false) {
    const supply = {
      visitStoreIds: async () => [1, 2, 3],
      period: async (storeId: number, month: string) => {
        if (failing) throw new Error('supply-service timed out')
        return imported[storeId]?.includes(month) ? { store_id: storeId } : null
      },
    }
    const sales = { period: async (storeId: number, month: string) => (imported[storeId]?.includes(month) ? [] : null) }
    const stores = { stores: async () => NAMES }
    const parameters = { current: async () => ({ values: { refresh: { availableStoreShare: 1 } } }) }
    const config = { get: () => undefined }

    return new FreshnessService(supply as never, sales as never, stores as never, parameters as never, config as never)
  }

  it('up to date: nothing newer than the analysis is available', async () => {
    const freshness = await service({ 1: ['2026-08', '2026-09'], 2: ['2026-08', '2026-09'] }).freshnessOf('2026-09', COMPUTED, NOW)

    expect(freshness).toMatchObject({ dataThrough: '2026-09', status: 'up_to_date', outOfDate: false, monthsLagged: 0, pendingImport: [] })
  })

  it('a month closed and imported but not incorporated: out of date by 1; the synthetic store is not an active store', async () => {
    // Store 3 is synthetic and has nothing imported; if it counted, September could not be available at 100%.
    const freshness = await service({ 1: ['2026-08', '2026-09'], 2: ['2026-08', '2026-09'] }).freshnessOf('2026-08', COMPUTED, NOW)

    expect(freshness).toMatchObject({ dataThrough: '2026-08', status: 'out_of_date', outOfDate: true, monthsLagged: 1, latestAvailableMonth: '2026-09' })
  })

  it('a month closed but not yet imported at enough stores is pendingImport, never covered, and not counted as a lag', async () => {
    const freshness = await service({ 1: ['2026-08', '2026-09'], 2: ['2026-08'] }).freshnessOf('2026-08', COMPUTED, NOW)

    expect(freshness).toMatchObject({ dataThrough: '2026-08', status: 'up_to_date', outOfDate: false, monthsLagged: 0 })
    expect(freshness.pendingImport).toEqual([{ month: '2026-09', importedStores: 1, activeStores: 2, share: 0.5, requiredShare: 1 }])
  })

  it('counts several months of lag', async () => {
    const all = ['2026-06', '2026-07', '2026-08', '2026-09']
    const freshness = await service({ 1: all, 2: all }).freshnessOf('2026-06', COMPUTED, NOW)

    expect(freshness).toMatchObject({ outOfDate: true, monthsLagged: 3, latestAvailableMonth: '2026-09' })
  })

  it('an unreadable source is "unknown", never read as up to date', async () => {
    const freshness = await service({ 1: ['2026-09'] }, true).freshnessOf('2026-08', COMPUTED, NOW)

    expect(freshness).toMatchObject({ dataThrough: '2026-08', status: 'unknown', outOfDate: null })
    expect(freshness.reason).toMatch(/timed out/)
  })

  it('nothing computed needs no probe', async () => {
    expect(await service({}).freshnessOf(null, null, NOW)).toMatchObject({ status: 'not_computed', dataThrough: null })
  })
})

import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import { buildAlerts, expiredIsRecurrent, type AlertInput } from './alerts'
import type { MonthlyFacts } from './engine.types'

const p = DEFAULT_PARAMETERS.alerts
const month = (m: string, removals: MonthlyFacts['removals'] = {}, restocked = 20): MonthlyFacts => ({ month: m, salesPresent: true, sold: 10, revenueCents: 6900, removals, restocked })
const base = (over: Partial<AlertInput> = {}): AlertInput => ({
  monthly: [month('2026-06'), month('2026-07'), month('2026-08')],
  pattern: 'stable',
  lowDemand: false,
  economics: { monthsCounted: 3, revenueCents: 20700, unitsSold: 30, lostUnits: 0, marginCents: 0, lossCostCents: 0, contributionCents: 0 },
  network: null,
  toleranceOutside: false,
  recurringAdjustment: false,
  salesMonthsMissing: [],
  rejectedAtIngestion: false,
  parameters: p,
  ...over,
})
const codes = (input: AlertInput) => buildAlerts(input).map(alert => alert.code)

describe('buildAlerts', () => {
  it('has none for a clean product', () => {
    expect(buildAlerts(base())).toEqual([])
  })

  it('expiry attention needs expired loss in at least two of the last three months', () => {
    expect(codes(base({ monthly: [month('2026-06', { expired: 2 }), month('2026-07'), month('2026-08')] }))).not.toContain('expiry_attention')
    expect(codes(base({ monthly: [month('2026-06', { expired: 2 }), month('2026-07', { expired: 1 }), month('2026-08')] }))).toContain('expiry_attention')
  })

  it('expiry is stronger when demand is low or declining', () => {
    const monthly = [month('2026-06', { expired: 2 }), month('2026-07', { expired: 3 }), month('2026-08')]

    expect(buildAlerts(base({ monthly })).find(a => a.code === 'expiry_attention')?.severity).toBe('normal')
    expect(buildAlerts(base({ monthly, pattern: 'declining' })).find(a => a.code === 'expiry_attention')?.severity).toBe('high')
    expect(buildAlerts(base({ monthly, lowDemand: true })).find(a => a.code === 'expiry_attention')?.severity).toBe('high')
  })

  it('expiredIsRecurrent reads only the last three months', () => {
    const monthly = [month('2026-01', { expired: 9 }), month('2026-02', { expired: 9 }), month('2026-06'), month('2026-07'), month('2026-08')]

    expect(expiredIsRecurrent(monthly, p)).toBe(false)
  })

  it('damage does not assume a demand problem and carries its scope', () => {
    const monthly = [month('2026-06', { damaged_product: 1 }), month('2026-07', { damaged_product: 2 }), month('2026-08')]

    expect(buildAlerts(base({ monthly })).find(a => a.code === 'investigate_damage')?.scope).toBe('local')
    expect(buildAlerts(base({ monthly, network: { exposedStores: 10, storesWithRemovalPattern: 0, storesWithDamage: 3 } })).find(a => a.code === 'investigate_damage')?.scope).toBe('several_stores')
    expect(buildAlerts(base({ monthly, network: { exposedStores: 10, storesWithRemovalPattern: 0, storesWithDamage: 7 } })).find(a => a.code === 'investigate_damage')?.scope).toBe('network')
  })

  it('"other reason" is investigated as other reason — never inferred as theft', () => {
    const monthly = [month('2026-06', { other_reason: 6 }), month('2026-07', { other_reason: 5 }), month('2026-08', { other_reason: 4 })]
    const alert = buildAlerts(base({ monthly })).find(a => a.code === 'investigate_losses')

    expect(alert).toBeDefined()
    expect(JSON.stringify(alert)).not.toMatch(/theft|roubo|furto/i)
  })

  it('review balance when outside tolerance or when adjustments recur', () => {
    expect(codes(base({ toleranceOutside: true }))).toContain('review_balance')
    expect(codes(base({ recurringAdjustment: true }))).toContain('review_balance')
    expect(codes(base())).not.toContain('review_balance')
  })

  it('incomplete data names the missing months and a rejected SKU', () => {
    const alert = buildAlerts(base({ salesMonthsMissing: ['2026-05'], rejectedAtIngestion: true })).find(a => a.code === 'incomplete_data')

    expect(alert?.detail).toEqual({ salesMonthsMissing: ['2026-05'], rejectedAtIngestion: true })
  })

  it('good sales and a high "other reason" loss still yield only an investigation, no removal cue', () => {
    const monthly = [month('2026-06', { other_reason: 6 }), month('2026-07', { other_reason: 5 }), month('2026-08', { other_reason: 4 })]

    expect(codes(base({ monthly }))).toEqual(['investigate_losses'])
  })
})

describe('presenceMonths — the window is months the SKU was present, not calendar months', () => {
  const absent = (m: string): MonthlyFacts => ({ month: m, salesPresent: true, sold: 0, revenueCents: 0, removals: {}, restocked: 0 })

  it('skips months with no restock, sale or removal', async () => {
    const { presenceMonths } = await import('./alerts')
    const monthly = [month('2026-03', { expired: 2 }), month('2026-04', { expired: 3 }), month('2026-05'), absent('2026-06'), absent('2026-07'), absent('2026-08')]

    expect(presenceMonths(monthly).map(m => m.month)).toEqual(['2026-03', '2026-04', '2026-05'])
  })

  it('so a product that stopped being restocked is still judged on its recurring expiry', () => {
    const monthly = [month('2026-03', { expired: 2 }), month('2026-04', { expired: 3 }), month('2026-05'), absent('2026-06'), absent('2026-07'), absent('2026-08')]

    expect(expiredIsRecurrent(monthly, p)).toBe(true)
  })
})

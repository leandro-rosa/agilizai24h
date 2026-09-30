import 'reflect-metadata'
import { ConfigService } from '@nestjs/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { AuditSourceClient } from './audit-source.client'
import { BalanceAuditService } from './balance-audit.service'
import type { AuditVisit } from '../utils/audit-types'

const at = (iso: string) => new Date(`${iso}Z`)

const visit = (storeId: number, end: string, sku: string, over: Partial<AuditVisit['lines'][number]> = {}): AuditVisit => ({
  storeId,
  endedAt: at(end),
  lines: [{ sku, balanceBefore: 10, confirmedCount: 10, restocked: 0, balanceAfter: 10, capacity: null, ...over }],
})

interface SourceFake {
  stores: number[]
  visits: Record<number, AuditVisit[] | Error>
  sales?: (storeId: number, month: string) => Map<string, number> | null | Error
}

const build = (fake: SourceFake, env: Record<string, unknown> = {}) => {
  const source = {
    visitStoreIds: jest.fn().mockResolvedValue(fake.stores),
    visits: jest.fn(async (storeId: number) => {
      const value = fake.visits[storeId]
      if (value instanceof Error) throw value
      return value ?? []
    }),
    sales: jest.fn(async (storeId: number, month: string) => {
      const value = fake.sales ? fake.sales(storeId, month) : new Map<string, number>()
      if (value instanceof Error) throw value
      return value
    }),
  }
  const config = { get: (key: string) => env[key] } as unknown as ConfigService

  return { service: new BalanceAuditService(source as unknown as AuditSourceClient, config), source }
}

describe('BalanceAuditService', () => {
  it('reports a store whose read failed as unavailable and leaves it out — never as zero', async () => {
    const { service } = build({
      stores: [1, 2],
      visits: { 1: [visit(1, '2026-03-05T10:00:00', 'A')], 2: new Error('supply-service timed out') },
    })

    const result = await service.audit('2026-03', '2026-04')

    expect(result.gaps.unavailable_stores).toEqual([{ store_id: 2, reason: 'supply-service timed out' }])
    expect(result.covered.stores).toBe(1)
    expect(result.count_vs_system.lines_total).toBe(1)
  })

  it('leaves a store out entirely when only its sales read fails, rather than auditing it without turnover', async () => {
    const { service } = build({
      stores: [1],
      visits: { 1: [visit(1, '2026-03-05T10:00:00', 'A')] },
      sales: () => new Error('sales-service down'),
    })

    const result = await service.audit('2026-03', '2026-04')

    expect(result.gaps.unavailable_stores).toHaveLength(1)
    expect(result.covered.stores).toBe(0)
  })

  it('treats a sales 404 (month never imported) as "not present", not as a failure', async () => {
    const { service } = build({
      stores: [1],
      visits: { 1: [visit(1, '2026-03-05T10:00:00', 'A')] },
      sales: () => null,
    })

    const result = await service.audit('2026-03', '2026-04')

    expect(result.gaps.unavailable_stores).toEqual([])
    expect(result.count_vs_system.by_turnover.unknown.lines).toBe(1)
  })

  it('returns an empty audit when no store has visits', async () => {
    const { service, source } = build({ stores: [], visits: {} })

    const result = await service.audit('2026-03', '2026-08')

    expect(result.covered).toMatchObject({ stores: 0, visits: 0, lines: 0 })
    expect(result.gaps.unavailable_stores).toEqual([])
    expect(source.visits).not.toHaveBeenCalled()
  })

  it('reads sales for every month of the range, for each store', async () => {
    const { service, source } = build({ stores: [1], visits: { 1: [visit(1, '2026-03-05T10:00:00', 'A')] } })

    await service.audit('2026-03', '2026-05')

    expect(source.sales.mock.calls.map(([, month]) => month)).toEqual(['2026-03', '2026-04', '2026-05'])
  })

  it('returns the bands it used, marked provisional, so the browser never owns them', async () => {
    const { service } = build({ stores: [], visits: {} }, { AUDIT_TURNOVER_HIGH_MIN: '30', AUDIT_TURNOVER_MEDIUM_MIN: '8' })

    const { presentation } = await service.audit('2026-03', '2026-03')

    expect(presentation.provisional).toBe(true)
    expect(presentation.turnover).toEqual({ high_min: 30, medium_min: 8 })
    expect(presentation.balance_bands).toEqual(['<0', '0', '1–5', '6–15', '16–40', '41+'])
  })

  it('falls back to the default bands when the configured ones are nonsense', async () => {
    const { service } = build(
      { stores: [], visits: {} },
      { AUDIT_TURNOVER_HIGH_MIN: '3', AUDIT_TURNOVER_MEDIUM_MIN: '9', AUDIT_BALANCE_UPPER_BOUNDS: '5,2' },
    )

    const { presentation } = await service.audit('2026-03', '2026-03')

    expect(presentation.turnover).toEqual({ high_min: 20, medium_min: 5 })
    expect(presentation.balance_bands).toEqual(['<0', '0', '1–5', '6–15', '16–40', '41+'])
  })

  it('has no verdict, tolerance or pass/fail key anywhere in the response', async () => {
    const { service } = build({
      stores: [1, 2],
      visits: { 1: [visit(1, '2026-03-05T10:00:00', 'A', { confirmedCount: 7 })], 2: new Error('boom') },
      sales: () => new Map([['A', 12]]),
    })

    const keys = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.flatMap(keys)
        : value && typeof value === 'object'
          ? Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)])
          : []

    const offending = keys(await service.audit('2026-03', '2026-04')).filter(key =>
      /verdict|toleran|pass|fail|accept|approv|aprov|reprov/i.test(key),
    )
    expect(offending).toEqual([])
  })

  it('reads nothing else and writes nothing: it depends only on the source client and config', () => {
    // A recommendation, an estimated balance or a supply suggestion could only
    // change with the audit if the audit reached them. It has no handle on any.
    expect(Reflect.getMetadata('design:paramtypes', BalanceAuditService)).toEqual([AuditSourceClient, ConfigService])
  })

  it('is registered before the inventory module, or /inventory/:storeId/:sku swallows its route', () => {
    // Read as text: importing AppModule would run the env validation at import time.
    const source = readFileSync(join(__dirname, '../../../app.module.ts'), 'utf8')
    const imports = source.slice(source.indexOf('imports: ['))

    expect(imports.indexOf('    BalanceAuditModule,')).toBeGreaterThan(-1)
    expect(imports.indexOf('    BalanceAuditModule,')).toBeLessThan(imports.indexOf('    InventoryModule,'))
  })
})

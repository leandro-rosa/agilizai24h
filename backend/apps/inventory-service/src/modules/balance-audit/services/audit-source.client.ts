import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import type { AuditVisit } from '../utils/audit-types'

interface VisitsResponse {
  visits: {
    ended_at: string
    lines: {
      sku: string
      balance_before: number
      confirmed_count: number | null
      restocked: number
      balance_after: number
      capacity: number | null
    }[]
  }[]
}

interface SalesRow {
  sku: string
  quantity_sold: number
}

/**
 * Reads what the audit compares, from the services that own it: visits from
 * `supply-service`, registered sales from `sales-service`.
 *
 * A failure is NOT translated into "no data" here — the one exception is a
 * sales 404, which is a real answer ("that month was never imported"). Anything
 * else throws, and the caller reports the store as unavailable instead of
 * folding a failed read into a zero.
 */
@Injectable()
export class AuditSourceClient {
  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  async visitStoreIds(from: string, to: string, correlationId?: string): Promise<number[]> {
    const base = this.config.getOrThrow<string>('SUPPLY_SERVICE_URL')
    const result = await this.http.send<{ store_ids: number[] }>({
      http_method: 'get',
      url: `${base}/visits/stores?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
      timeout: 15000,
    })

    return (result.response.data as { store_ids: number[] }).store_ids ?? []
  }

  async visits(storeId: number, from: string, to: string, correlationId?: string): Promise<AuditVisit[]> {
    const base = this.config.getOrThrow<string>('SUPPLY_SERVICE_URL')
    const result = await this.http.send<VisitsResponse>({
      http_method: 'get',
      url: `${base}/supply/${storeId}/visits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
      timeout: 30000,
    })

    return ((result.response.data as VisitsResponse).visits ?? []).map(visit => ({
      storeId,
      endedAt: new Date(visit.ended_at),
      lines: visit.lines.map(line => ({
        sku: line.sku,
        balanceBefore: line.balance_before,
        confirmedCount: line.confirmed_count,
        restocked: line.restocked,
        balanceAfter: line.balance_after,
        capacity: line.capacity,
      })),
    }))
  }

  /** Registered sales of one store and month, or `null` when that month was never imported (a 404 there). */
  async sales(storeId: number, month: string, correlationId?: string): Promise<Map<string, number> | null> {
    const base = this.config.getOrThrow<string>('SALES_SERVICE_URL')

    try {
      const result = await this.http.send<SalesRow[]>({
        http_method: 'get',
        url: `${base}/sales/${storeId}?period=${encodeURIComponent(month)}`,
        headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
        timeout: 15000,
      })

      const bySku = new Map<string, number>()
      for (const row of (result.response.data as SalesRow[]) ?? []) {
        bySku.set(row.sku, (bySku.get(row.sku) ?? 0) + row.quantity_sold)
      }

      return bySku
    } catch (error) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) return null
      throw error
    }
  }
}

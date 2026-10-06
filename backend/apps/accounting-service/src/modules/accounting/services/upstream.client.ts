import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'

export interface ActiveStore {
  id: number
  name: string
}

interface TreasuryTransaction {
  kind: string
  direction: 'inflow' | 'outflow'
  amount_cents: number
  category: string
  neutralized_with_id: number | null
}

/**
 * Reads the four services the DRE auto-fill is built from. A 404 means
 * "no data for that store/period", a real answer that must never be
 * mistaken for a transport failure — the two lead to very different
 * ledger entries (skip vs. abort). Same shape as finance-service's own
 * UpstreamClient, on purpose.
 */
@Injectable()
export class UpstreamClient {
  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  async activeStores(correlationId?: string): Promise<ActiveStore[]> {
    const stores = await this.get<{ id: number; name: string; status: string }[]>(
      `${this.config.getOrThrow<string>('STORES_SERVICE_URL')}/stores`,
      [],
      correlationId,
    )
    return stores.filter(s => s.status === 'active').map(s => ({ id: s.id, name: s.name }))
  }

  async salesRevenueCents(storeId: number, period: string, correlationId?: string): Promise<number> {
    const result = await this.get<{ total_revenue_cents: number } | null>(
      `${this.config.getOrThrow<string>('SALES_SERVICE_URL')}/sales/${storeId}/totals?period=${encodeURIComponent(period)}`,
      null,
      correlationId,
    )
    return result?.total_revenue_cents ?? 0
  }

  async financeFor(
    storeId: number,
    period: string,
    correlationId?: string,
  ): Promise<{ cogs_cents: number; loss_value_cents: number } | null> {
    return this.get<{ cogs_cents: number; loss_value_cents: number } | null>(
      `${this.config.getOrThrow<string>('FINANCE_SERVICE_URL')}/finance/${storeId}/${encodeURIComponent(period)}`,
      null,
      correlationId,
    )
  }

  /** Keyed by the raw `category` text; value is |inflow − outflow| cents, revenue and expense alike. */
  async treasuryCategoryTotals(period: string, correlationId?: string): Promise<Map<string, number>> {
    const rows = await this.get<TreasuryTransaction[]>(
      `${this.config.getOrThrow<string>('TREASURY_SERVICE_URL')}/treasury/transactions?period=${encodeURIComponent(period)}`,
      [],
      correlationId,
    )

    const net = new Map<string, number>()
    for (const row of rows) {
      if (row.kind !== 'revenue' && row.kind !== 'expense') continue
      if (row.neutralized_with_id !== null) continue
      const signed = row.direction === 'inflow' ? row.amount_cents : -row.amount_cents
      net.set(row.category, (net.get(row.category) ?? 0) + signed)
    }

    return new Map([...net.entries()].map(([category, value]) => [category, Math.abs(value)]))
  }

  /** Cada entrada (inflow) de uma categoria no mês, em centavos — para regras que olham o valor, não só o total. */
  async treasuryInflowAmounts(period: string, category: string, correlationId?: string): Promise<number[]> {
    const rows = await this.get<TreasuryTransaction[]>(
      `${this.config.getOrThrow<string>('TREASURY_SERVICE_URL')}/treasury/transactions?period=${encodeURIComponent(period)}`,
      [],
      correlationId,
    )

    return rows
      .filter(r => r.kind === 'revenue' && r.direction === 'inflow' && r.category === category && r.neutralized_with_id === null)
      .map(r => r.amount_cents)
  }

  private async get<T>(url: string, whenAbsent: T, correlationId?: string): Promise<T> {
    try {
      const result = await this.http.send<T>({
        http_method: 'get',
        url,
        headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
        timeout: 8000,
      })
      return (result.response.data as T) ?? whenAbsent
    } catch (error) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) return whenAbsent
      throw error
    }
  }
}

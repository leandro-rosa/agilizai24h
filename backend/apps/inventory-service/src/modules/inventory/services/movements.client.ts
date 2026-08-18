import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import type { PeriodMovements } from '../utils/derive-stock'

interface SalesRow {
  sku: string
  quantity_sold: number
}

interface SupplyPeriod {
  restocks: { sku: string; quantity_restocked: number }[]
  removals: { sku: string; quantity_removed: number }[]
}

/**
 * Reads movement quantities from the services that own them.
 *
 * A period that was never ingested answers 404 there, which is a real answer —
 * "no data" — and must not be mistaken for a transport failure.
 */
@Injectable()
export class MovementsClient {
  private readonly logger = new Logger(MovementsClient.name)

  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  /** Movements per SKU for one store and period, merged from both sources. */
  async movementsFor(storeId: number, period: string, correlationId?: string): Promise<Map<string, PeriodMovements>> {
    const [sales, supply] = await Promise.all([
      this.salesFor(storeId, period, correlationId),
      this.supplyFor(storeId, period, correlationId),
    ])

    const merged = new Map<string, PeriodMovements>()
    const ensure = (sku: string) => {
      if (!merged.has(sku)) merged.set(sku, { period, restocked: 0, sold: 0, removed: 0 })
      return merged.get(sku)!
    }

    for (const row of sales) ensure(row.sku).sold += row.quantity_sold
    for (const row of supply.restocks) ensure(row.sku).restocked += row.quantity_restocked
    // Every removal counts, regardless of its loss classification.
    for (const row of supply.removals) ensure(row.sku).removed += row.quantity_removed

    return merged
  }

  private async salesFor(storeId: number, period: string, correlationId?: string): Promise<SalesRow[]> {
    const base = this.config.getOrThrow<string>('SALES_SERVICE_URL')

    try {
      const result = await this.http.send<SalesRow[]>({
        http_method: 'get',
        url: `${base}/sales/${storeId}?period=${encodeURIComponent(period)}`,
        headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
        timeout: 8000,
      })

      return (result.response.data as SalesRow[]) ?? []
    } catch (error) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) return []
      throw error
    }
  }

  private async supplyFor(storeId: number, period: string, correlationId?: string): Promise<SupplyPeriod> {
    const base = this.config.getOrThrow<string>('SUPPLY_SERVICE_URL')

    try {
      const result = await this.http.send<SupplyPeriod>({
        http_method: 'get',
        url: `${base}/supply/${storeId}?period=${encodeURIComponent(period)}`,
        headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
        timeout: 8000,
      })

      return (result.response.data as SupplyPeriod) ?? { restocks: [], removals: [] }
    } catch (error) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) {
        return { restocks: [], removals: [] }
      }
      throw error
    }
  }
}

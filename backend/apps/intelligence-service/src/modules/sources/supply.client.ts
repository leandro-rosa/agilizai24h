import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import { httpGet } from './http-read'

export interface SupplyVisitLineDto {
  sku: string
  balance_before: number
  confirmed_count: number | null
  quantity_to_restock: number | null
  restocked: number
  removed_total: number
  adjustment: number
  balance_after: number
  capacity: number | null
}

export interface SupplyVisitDto {
  id: number
  period: string
  kind: string
  started_at: string | null
  ended_at: string
  previous_ended_at: string | null
  source_reference: string
  lines: SupplyVisitLineDto[]
}

export interface SupplyPeriodDto {
  store_id: number
  period: string
  restocks: { sku: string; quantity_restocked: number }[]
  removals: { sku: string; reason: string; counts_as_loss: boolean; quantity_removed: number }[]
  adjustments: { sku: string; quantity: number }[]
}

@Injectable()
export class SupplyClient {
  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  private base(): string {
    return this.config.getOrThrow<string>('SUPPLY_SERVICE_URL')
  }

  async visitStoreIds(from: string, to: string, correlationId?: string): Promise<number[]> {
    const body = await httpGet<{ store_ids: number[] }>(
      this.http,
      `${this.base()}/visits/stores?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { correlationId },
    )

    return body?.store_ids ?? []
  }

  async visits(storeId: number, from: string, to: string, correlationId?: string): Promise<SupplyVisitDto[]> {
    const body = await httpGet<{ visits: SupplyVisitDto[] }>(
      this.http,
      `${this.base()}/supply/${storeId}/visits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { correlationId, timeout: 60000 },
    )

    return body?.visits ?? []
  }

  /** Restocks and removals by reason for one store-month; `null` when that month was never ingested. */
  period(storeId: number, period: string, correlationId?: string): Promise<SupplyPeriodDto | null> {
    return httpGet<SupplyPeriodDto>(this.http, `${this.base()}/supply/${storeId}?period=${encodeURIComponent(period)}`, {
      correlationId,
      notFoundIsNull: true,
    })
  }
}

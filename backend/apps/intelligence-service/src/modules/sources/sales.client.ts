import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import { httpGet } from './http-read'

export interface SalesRowDto {
  sku: string
  quantity_sold: number
  revenue_cents: number
}

/** One receipt line. `occurred_at` is null on rows imported before the date column was read. */
export interface SalesTransactionDto {
  sku: string
  quantity: number
  amount_paid_cents: number
  result: string
  occurred_at: string | null
}

@Injectable()
export class SalesClient {
  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  /** Monthly sales of one store; `null` when that month was never imported — never an empty list of zeroes. */
  period(storeId: number, period: string, correlationId?: string): Promise<SalesRowDto[] | null> {
    return httpGet<SalesRowDto[]>(
      this.http,
      `${this.config.getOrThrow<string>('SALES_SERVICE_URL')}/sales/${storeId}?period=${encodeURIComponent(period)}`,
      { correlationId, notFoundIsNull: true },
    )
  }

  /** Receipt lines of one store-month, with their timestamps; `null` when that month has no transaction detail (404). */
  transactions(storeId: number, period: string, correlationId?: string): Promise<SalesTransactionDto[] | null> {
    return httpGet<SalesTransactionDto[]>(
      this.http,
      `${this.config.getOrThrow<string>('SALES_SERVICE_URL')}/sales/${storeId}/transactions?period=${encodeURIComponent(period)}`,
      { correlationId, notFoundIsNull: true, timeout: 60000 },
    )
  }
}

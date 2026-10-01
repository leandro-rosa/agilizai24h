import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import { httpGet } from './http-read'

export interface SalesRowDto {
  sku: string
  quantity_sold: number
  revenue_cents: number
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
}

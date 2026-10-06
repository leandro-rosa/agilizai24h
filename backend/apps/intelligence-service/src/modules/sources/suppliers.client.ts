import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import { httpGet } from './http-read'

/** One month of purchases by SKU, by condition (see suppliers-service `GET /purchases/summary`). */
export interface PurchaseSummaryDto {
  month: string
  /** First month with any purchase; null while there is none. */
  base_from: string | null
  orders: number
  invoices: number
  rows: { sku: string; units_paid: number; units_on_sale: number; bonus_units: number; cents_paid: number; cents_on_sale: number }[]
}

@Injectable()
export class SuppliersClient {
  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  async purchaseSummary(month: string, correlationId?: string): Promise<PurchaseSummaryDto> {
    const body = await httpGet<PurchaseSummaryDto>(this.http, `${this.config.getOrThrow<string>('SUPPLIERS_SERVICE_URL')}/purchases/summary?month=${encodeURIComponent(month)}`, { correlationId })

    return body as PurchaseSummaryDto
  }
}

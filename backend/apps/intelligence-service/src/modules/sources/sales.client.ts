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

/** Revenue of `OK` receipts by payment method, acquirer and card brand. */
export interface PaymentMixDto {
  from: string
  to: string
  store_id: number | null
  rows: {
    method: string | null
    acquirer: string | null
    card_brand: string | null
    receipt_lines: number
    amount_paid_cents: number
    /** Units sold in those lines, the tickets (distinct coupon / transaction code / acquirer code plus each unidentified line once) and how many lines had no identifier at all. Absent from an older sales service. */
    units?: number
    tickets?: number
    lines_without_ticket_id?: number
  }[]
  total_amount_paid_cents: number
  /** Months with no receipts for the scope: the mix there is unknown, not zero. */
  periods_without_transactions: string[]
}

/** The payment mix split per product: what a product's own, its category's and the network's mix are built from. */
export interface PaymentMixBySkuDto {
  from: string
  to: string
  store_id: number | null
  rows: { sku: string; method: string | null; acquirer: string | null; card_brand: string | null; receipt_lines: number; units: number; amount_paid_cents: number }[]
  periods_without_transactions: string[]
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

  /** The payment mix over a window of months, for one store or the network. */
  async paymentMix(from: string, to: string, storeId?: number, correlationId?: string): Promise<PaymentMixDto> {
    const store = storeId === undefined ? '' : `&storeId=${storeId}`
    const body = await httpGet<PaymentMixDto>(
      this.http,
      `${this.config.getOrThrow<string>('SALES_SERVICE_URL')}/sales/network/payment-mix?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${store}`,
      { correlationId, timeout: 60000 },
    )

    return body as PaymentMixDto
  }

  /** The payment mix of each product over a window of months; `null` from an older sales service that does not have the route. */
  async paymentMixBySku(from: string, to: string, storeId?: number, correlationId?: string): Promise<PaymentMixBySkuDto | null> {
    const store = storeId === undefined ? '' : `&storeId=${storeId}`

    return httpGet<PaymentMixBySkuDto>(
      this.http,
      `${this.config.getOrThrow<string>('SALES_SERVICE_URL')}/sales/network/payment-mix-by-sku?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${store}`,
      { correlationId, timeout: 60000, notFoundIsNull: true },
    )
  }
}

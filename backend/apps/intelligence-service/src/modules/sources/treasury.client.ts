import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import { httpGet } from './http-read'

export interface RatesInForceDto {
  on: string
  rates: { acquirer: string; payment_method: 'pix' | 'debit' | 'credit' | 'voucher'; rate_bps: number; effective_from: string }[]
  /** Methods with no rate registered on that date — never a 0% rate. */
  methods_without_rate: string[]
}

@Injectable()
export class TreasuryClient {
  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  /** The acquirer fees registered and in force on a date (read-only). */
  async feesInForce(on: string, correlationId?: string): Promise<RatesInForceDto> {
    const body = await httpGet<RatesInForceDto>(
      this.http,
      `${this.config.getOrThrow<string>('TREASURY_SERVICE_URL')}/treasury/fees/in-force?on=${encodeURIComponent(on)}`,
      { correlationId },
    )

    return body as RatesInForceDto
  }
}

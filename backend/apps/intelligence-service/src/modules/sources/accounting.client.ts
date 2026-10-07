import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import { httpGet } from './http-read'

export interface PnlAccountDto {
  code: string
  label: string
  section: string
  amount_cents: number
  children: PnlAccountDto[]
}

export interface PnlDto {
  period: string
  store_id: number | null
  sections: { section: string; amount_cents: number; accounts: PnlAccountDto[] }[]
}

@Injectable()
export class AccountingClient {
  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  /** The month's P&L tree, network-wide or for one store; `null` when that month was never computed (404). */
  pnl(period: string, storeId?: number, correlationId?: string): Promise<PnlDto | null> {
    const store = storeId === undefined ? '' : `?store_id=${storeId}`

    return httpGet<PnlDto>(this.http, `${this.config.getOrThrow<string>('ACCOUNTING_SERVICE_URL')}/accounting/pnl/${encodeURIComponent(period)}${store}`, {
      correlationId,
      notFoundIsNull: true,
    })
  }
}

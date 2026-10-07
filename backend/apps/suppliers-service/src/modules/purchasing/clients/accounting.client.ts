import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { readJson } from './read-json'

/** Read-only: whether a month is already closed in the accounting. Optional — without the URL the answer is "unknown", never "open". */
@Injectable()
export class AccountingClient {
  constructor(private readonly config: ConfigService) {}

  /** `closed`, `open`, or `unknown` (not configured or unreachable). */
  async monthStatus(period: string, correlationId?: string): Promise<'closed' | 'open' | 'unknown'> {
    const base = this.config.get<string>('ACCOUNTING_SERVICE_URL')
    if (!base) return 'unknown'
    try {
      const pnl = await readJson<{ status?: string }>(`${base}/accounting/pnl/${period}`, { correlationId, timeoutMs: 10_000, notFoundIsNull: true })
      if (!pnl?.status) return 'unknown'

      return pnl.status === 'closed' ? 'closed' : 'open'
    } catch {
      return 'unknown'
    }
  }
}

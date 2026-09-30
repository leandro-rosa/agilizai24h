import { BadRequestException, Controller, Get, Headers, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { BalanceAuditService } from '../services/balance-audit.service'

/** `YYYY-MM` — every period in this platform is a whole month, never finer. */
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Network-wide and read-only. Lives in its own controller, registered BEFORE
 * `InventoryController`, because `GET /inventory/:storeId/:sku` would otherwise
 * swallow `/inventory/audit/balance` and answer 400 for a non-numeric store.
 */
@ApiTags('inventory')
@Controller('inventory/audit')
export class BalanceAuditController {
  constructor(private readonly audit: BalanceAuditService) {}

  @Get('balance')
  @ApiOperation({
    summary: 'How far the balance can be trusted: counts and consumption against the system',
    description:
      'Distributions and counts only — no verdict and no tolerance. Computed on read from supply visits and ' +
      'registered sales; stores whose data could not be read are listed, never counted as zero.',
  })
  @ApiQuery({ name: 'from', required: true, example: '2026-03' })
  @ApiQuery({ name: 'to', required: true, example: '2026-08' })
  balance(@Query('from') from: string, @Query('to') to: string, @Headers('x-correlation-id') correlationId?: string) {
    if (!PERIOD_PATTERN.test(from ?? '') || !PERIOD_PATTERN.test(to ?? '') || from > to) {
      throw new BadRequestException('from and to are required, as YYYY-MM, with from <= to')
    }

    return this.audit.audit(from, to, correlationId)
  }
}

import { BadRequestException, Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SalesService } from '../services/sales.service'
import { SalesTransactionsService } from '../services/sales-transactions.service'

@ApiTags('sales')
@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly transactions: SalesTransactionsService,
  ) {}

  /** Declared before `:storeId` so "network" is not read as a store id. */
  @Get('network/sold-by-sku')
  @ApiOperation({
    summary: 'Units sold per SKU over a window of days, network-wide, from dated receipts',
    description: 'Only `OK` receipts with a timestamp count. `months_without_dated_receipts` lists the months of the window whose day sales are unknown.',
  })
  @ApiQuery({ name: 'from', required: true, example: '2026-10-05' })
  @ApiQuery({ name: 'to', required: true, example: '2026-10-11' })
  @ApiQuery({ name: 'skus', required: true, description: 'Comma separated' })
  soldBySku(@Query('from') from: string, @Query('to') to: string, @Query('skus') skus: string) {
    const real = (day?: string) => !!day && /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day
    if (!real(from) || !real(to) || from > to) throw new BadRequestException('from and to must be real dates, YYYY-MM-DD, with from <= to')

    return this.transactions.soldBySku(from, to, (skus ?? '').split(',').map(s => s.trim()).filter(Boolean))
  }

  @Get('network/payment-mix')
  @ApiOperation({
    summary: 'Revenue by payment method, acquirer and card brand over a window of months',
    description:
      'From `OK` receipts only. Without `storeId` it is the whole network. `periods_without_transactions` lists months whose mix is unknown, not zero.',
  })
  @ApiQuery({ name: 'from', required: true, example: '2026-07' })
  @ApiQuery({ name: 'to', required: true, example: '2026-09' })
  @ApiQuery({ name: 'storeId', required: false })
  paymentMix(@Query('from') from: string, @Query('to') to: string, @Query('storeId') storeId?: string) {
    const month = /^\d{4}-(0[1-9]|1[0-2])$/
    if (!month.test(from ?? '') || !month.test(to ?? '') || from > to) throw new BadRequestException('from and to must be months, YYYY-MM, with from <= to')
    if (storeId !== undefined && !/^\d+$/.test(storeId)) throw new BadRequestException('storeId must be a positive integer')

    return this.transactions.paymentMix(from, to, storeId === undefined ? undefined : Number(storeId))
  }

  @Get(':storeId')
  @ApiOperation({
    summary: 'Sales rows for a store and period',
    description: 'One row per SKU. 404 when the period was never ingested — deliberately not an empty list of zeroes.',
  })
  @ApiQuery({ name: 'period', required: true, example: '2026-03' })
  @ApiResponse({ status: 404, description: 'That store and period was never ingested' })
  findPeriod(@Param('storeId', ParseIntPipe) storeId: number, @Query('period') period: string) {
    return this.sales.findPeriod(storeId, period)
  }

  @Get(':storeId/totals')
  @ApiOperation({
    summary: 'Aggregated totals for a store and period',
    description: 'Summed in the database, so callers deriving COGS do not re-aggregate.',
  })
  @ApiQuery({ name: 'period', required: true, example: '2026-03' })
  totals(@Param('storeId', ParseIntPipe) storeId: number, @Query('period') period: string) {
    return this.sales.totals(storeId, period)
  }

  @Get(':storeId/transactions')
  @ApiOperation({
    summary: 'Sales transaction detail for a store and period',
    description:
      'One row per transaction (timestamp, payment method, discount, buyer, POS identifiers, result) — only ' +
      'present for stores/periods ingested from the network-wide, per-transaction sales format. 404 when no ' +
      'transaction detail exists for that store and period, whether because it was never ingested or because ' +
      'the source report carried no transaction-level columns.',
  })
  @ApiQuery({ name: 'period', required: true, example: '2026-08' })
  @ApiResponse({ status: 404, description: 'No transaction detail for that store and period' })
  findPeriodTransactions(@Param('storeId', ParseIntPipe) storeId: number, @Query('period') period: string) {
    return this.transactions.findPeriod(storeId, period)
  }
}

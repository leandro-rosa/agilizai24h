import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common'
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

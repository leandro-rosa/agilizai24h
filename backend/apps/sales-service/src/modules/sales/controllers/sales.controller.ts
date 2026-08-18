import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SalesService } from '../services/sales.service'

@ApiTags('sales')
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

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
}

import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { FinanceService } from '../services/finance.service'

@ApiTags('finance')
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('rollup')
  @ApiOperation({
    summary: 'Network total for a month',
    description:
      'Aggregated across stores. `complete` is false when ANY contributing store is incomplete, and the stores responsible are named — a total containing an unpriced store is not a figure to act on.',
  })
  @ApiQuery({ name: 'period', required: true, example: '2026-03' })
  rollup(@Query('period') period: string) {
    return this.finance.rollup(period)
  }

  @Get(':storeId')
  @ApiOperation({ summary: 'Every reconciled month for a store, oldest first' })
  series(@Param('storeId', ParseIntPipe) storeId: number) {
    return this.finance.series(storeId)
  }

  @Get(':storeId/:period')
  @ApiOperation({
    summary: "One store's month",
    description:
      'The four figures, the loss breakdowns, the valuation date used, and the completeness statement with the SKUs that could not be valued.',
  })
  @ApiResponse({ status: 404, description: 'That month was never reconciled — deliberately not zeroes' })
  findOne(@Param('storeId', ParseIntPipe) storeId: number, @Param('period') period: string) {
    return this.finance.findOne(storeId, period)
  }

  @Post(':storeId/:period/recompute')
  @ApiOperation({
    summary: 'Recompute a store-month',
    description:
      'For backfills and for cost corrections, which change figures without any supply or sales data changing and therefore produce no event.',
  })
  recompute(@Param('storeId', ParseIntPipe) storeId: number, @Param('period') period: string) {
    return this.finance.recompute(storeId, period)
  }
}

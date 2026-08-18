import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ReconciliationResponseDto, RollupResponseDto } from '../dto/reconciliation.response.dto'
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
  @ApiResponse({ status: 200, type: RollupResponseDto })
  @ApiResponse({ status: 404, description: 'No store was reconciled for that month' })
  rollup(@Query('period') period: string) {
    return this.finance.rollup(period)
  }

  @Get(':storeId')
  @ApiOperation({ summary: 'Every reconciled month for a store, oldest first' })
  @ApiResponse({ status: 200, type: [ReconciliationResponseDto] })
  series(@Param('storeId', ParseIntPipe) storeId: number) {
    return this.finance.series(storeId)
  }

  @Get(':storeId/:period')
  @ApiOperation({
    summary: "One store's month",
    description:
      'Restocked value, COGS, remaining stock value and real loss — all in centavos (integer minor units) — with the ' +
      'loss breakdowns by reason and by product, the valuation date used, and the completeness statement naming the ' +
      'SKUs that could not be valued.',
  })
  @ApiResponse({ status: 200, type: ReconciliationResponseDto })
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
  @ApiResponse({ status: 201, type: ReconciliationResponseDto })
  recompute(@Param('storeId', ParseIntPipe) storeId: number, @Param('period') period: string) {
    return this.finance.recompute(storeId, period)
  }
}

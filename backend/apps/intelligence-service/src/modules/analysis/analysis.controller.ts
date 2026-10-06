import { BadRequestException, Controller, Get, Headers, Param, ParseIntPipe, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { CompareTo } from './analysis.types'
import { AnalysisService, type RangeInput } from './analysis.service'

/**
 * Read-only. The range is `fromDate`..`toDate` (`YYYY-MM-DD`, up to 366 days) or, as months, `from`..`period` (`YYYY-MM`, up to 12).
 * Whole months use the monthly records; the edge days of a range are read from visits and dated receipts (losses allocated, flagged estimated).
 * `compareTo` is `prev_month` (default) or `avg_3m` (single month only; any longer range is compared with the period right before it).
 * Purchase figures come back as unavailable (`no_purchase_history`) until a purchase source exists.
 */
@ApiTags('analysis')
@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Get('suppliers/:id')
  @ApiOperation({ summary: 'Movement, comparison, 6-month evolution and insights of one supplier' })
  supplier(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: RangeQuery,
    @Query('compareTo') compareTo: CompareTo = 'prev_month',
    @Query('storeId') storeId?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.analysis.supplier(id, rangeOf(query), compareTo, correlationId, storeId ? Number(storeId) : undefined)
  }

  @Get('products/:sku')
  @ApiOperation({ summary: 'Movement, comparison, per-store performance, 6-month evolution and insights of one product' })
  product(
    @Param('sku') sku: string,
    @Query() query: RangeQuery,
    @Query('compareTo') compareTo: CompareTo = 'prev_month',
    @Query('storeId') storeId?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.analysis.product(sku, rangeOf(query), compareTo, correlationId, storeId ? Number(storeId) : undefined)
  }

  @Get('cross')
  @ApiOperation({ summary: 'One product as bought from one supplier (declared link only)' })
  cross(
    @Query('supplierId', ParseIntPipe) supplierId: number,
    @Query('sku') sku: string,
    @Query() query: RangeQuery,
    @Query('compareTo') compareTo: CompareTo = 'prev_month',
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.analysis.cross(supplierId, sku, rangeOf(query), compareTo, correlationId)
  }
}

interface RangeQuery {
  period?: string
  from?: string
  fromDate?: string
  toDate?: string
}

/** The range asked for in whichever form it came: days win over months. */
function rangeOf(query: RangeQuery): RangeInput {
  if (query.fromDate && query.toDate) return { from: query.fromDate, to: query.toDate }
  if (!query.period) throw new BadRequestException('give fromDate and toDate (YYYY-MM-DD) or period (YYYY-MM)')

  return { from: query.from ?? query.period, to: query.period }
}

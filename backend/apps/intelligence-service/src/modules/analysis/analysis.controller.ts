import { Controller, Get, Headers, Param, ParseIntPipe, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { CompareTo } from './analysis.types'
import { AnalysisService } from './analysis.service'

/**
 * Read-only. `period` is the last month (`YYYY-MM`) and `from` the first, when a range of up to 12 months is asked for.
 * `compareTo` is `prev_month` (default) or `avg_3m` (single month only; a range is compared with the period right before it).
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
    @Query('period') period: string,
    @Query('compareTo') compareTo: CompareTo = 'prev_month',
    @Query('storeId') storeId?: string,
    @Query('from') from?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.analysis.supplier(id, period, compareTo, correlationId, storeId ? Number(storeId) : undefined, from)
  }

  @Get('products/:sku')
  @ApiOperation({ summary: 'Movement, comparison, per-store performance, 6-month evolution and insights of one product' })
  product(
    @Param('sku') sku: string,
    @Query('period') period: string,
    @Query('compareTo') compareTo: CompareTo = 'prev_month',
    @Query('storeId') storeId?: string,
    @Query('from') from?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.analysis.product(sku, period, compareTo, correlationId, storeId ? Number(storeId) : undefined, from)
  }

  @Get('cross')
  @ApiOperation({ summary: 'One product as bought from one supplier (declared link only)' })
  cross(
    @Query('supplierId', ParseIntPipe) supplierId: number,
    @Query('sku') sku: string,
    @Query('period') period: string,
    @Query('compareTo') compareTo: CompareTo = 'prev_month',
    @Query('from') from?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.analysis.cross(supplierId, sku, period, compareTo, correlationId, from)
  }
}

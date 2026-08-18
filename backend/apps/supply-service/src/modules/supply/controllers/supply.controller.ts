import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SupplyService } from '../services/supply.service'

@ApiTags('supply')
@Controller()
export class SupplyController {
  constructor(private readonly supply: SupplyService) {}

  @Get('reasons')
  @ApiOperation({
    summary: 'The removal reasons and their loss classification',
    description:
      'The rule as data, so a displayed figure can show which reasons produced it rather than leaving it implicit in a query.',
  })
  listReasons() {
    return this.supply.listReasons()
  }

  @Get('supply/:storeId')
  @ApiOperation({
    summary: 'Restocks and per-reason removals for a store and period',
    description:
      'Each removal is marked with whether its reason counts as loss, so a caller valuing the period receives quantities it does not have to re-derive.',
  })
  @ApiQuery({ name: 'period', required: true, example: '2026-03' })
  @ApiResponse({ status: 404, description: 'That store and period was never ingested' })
  findPeriod(@Param('storeId', ParseIntPipe) storeId: number, @Query('period') period: string) {
    return this.supply.findPeriod(storeId, period)
  }

  @Get('supply/:storeId/loss')
  @ApiOperation({
    summary: 'Real loss for a store and period',
    description: 'In total, by reason and by SKU. Derived from the per-reason rows, never stored.',
  })
  @ApiQuery({ name: 'period', required: true, example: '2026-03' })
  findLoss(@Param('storeId', ParseIntPipe) storeId: number, @Query('period') period: string) {
    return this.supply.findLoss(storeId, period)
  }
}

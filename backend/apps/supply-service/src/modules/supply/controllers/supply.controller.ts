import { BadRequestException, Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { isValidPeriod } from '@app/ingestion-contracts'
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

  @Get('visits/stores')
  @ApiOperation({
    summary: 'The stores that have supply visits in a range of periods',
    description: 'For a network-wide reader to know which stores to read visits for. Empty list when there are none.',
  })
  @ApiQuery({ name: 'from', required: true, example: '2026-03' })
  @ApiQuery({ name: 'to', required: true, example: '2026-07' })
  async findVisitStores(@Query('from') from: string, @Query('to') to: string) {
    if (!isValidPeriod(from) || !isValidPeriod(to) || from > to) {
      throw new BadRequestException('from and to are required, as YYYY-MM, with from <= to')
    }

    return { from, to, store_ids: await this.supply.findVisitStoreIds(from, to) }
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

  @Get('supply/:storeId/visits')
  @ApiOperation({
    summary: "A store's supply visits and their lines over a range of periods",
    description:
      'Ordered by the visit end instant. `confirmed_count` is the count made BEFORE restocking and is null ' +
      'when the line was not counted — null is never zero. An empty list for a range with no visits.',
  })
  @ApiQuery({ name: 'from', required: true, example: '2026-03' })
  @ApiQuery({ name: 'to', required: true, example: '2026-07' })
  findVisits(@Param('storeId', ParseIntPipe) storeId: number, @Query('from') from: string, @Query('to') to: string) {
    if (!isValidPeriod(from) || !isValidPeriod(to) || from > to) {
      throw new BadRequestException('from and to are required, as YYYY-MM, with from <= to')
    }

    return this.supply.findVisits(storeId, from, to)
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

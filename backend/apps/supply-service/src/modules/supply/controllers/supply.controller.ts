import { BadRequestException, Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { isValidPeriod } from '@app/ingestion-contracts'
import { SupplyService } from '../services/supply.service'

const isValidDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

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

  @Get('visits/counts')
  @ApiOperation({
    summary: 'Restocking visits per store and month',
    description:
      'A visit that restocked at least one unit (restocking or combined operation); count-only visits are reported apart. One visit is one store served in one operation, deduplicated by store and end instant. A month with no visits has no row: unknown, not zero.',
  })
  @ApiQuery({ name: 'from', required: true, example: '2026-07' })
  @ApiQuery({ name: 'to', required: true, example: '2026-09' })
  findVisitCounts(@Query('from') from: string, @Query('to') to: string) {
    if (!isValidPeriod(from) || !isValidPeriod(to) || from > to) {
      throw new BadRequestException('from and to are required, as YYYY-MM, with from <= to')
    }

    return this.supply.findVisitCounts(from, to)
  }

  /** Declared before `supply/:storeId` so "network" is not read as a store id. */
  @Get('supply/network/removals')
  @ApiOperation({
    summary: 'Units removed per SKU, month and reason, network-wide',
    description:
      'Read-only, for a supplier closing. The supply data keeps only the MONTH of a removal, never the day: a caller that needs a window of days gets the whole months it touches, labelled as such.',
  })
  @ApiQuery({ name: 'from', required: true, example: '2026-09' })
  @ApiQuery({ name: 'to', required: true, example: '2026-10' })
  @ApiQuery({ name: 'skus', required: true, description: 'Comma separated' })
  findNetworkRemovals(@Query('from') from: string, @Query('to') to: string, @Query('skus') skus: string) {
    if (!isValidPeriod(from) || !isValidPeriod(to) || from > to) {
      throw new BadRequestException('from and to are required, as YYYY-MM, with from <= to')
    }

    return this.supply.findNetworkRemovals(from, to, (skus ?? '').split(',').map(s => s.trim()).filter(Boolean))
  }

  @Get('supply/network/balances')
  @ApiOperation({
    summary: 'Current stock per SKU in the stores: the balance after each store\'s latest visit, summed',
    description:
      'Read-only, for a supplier closing. Only stores that ever had a visit line for the SKU count; `last_visit` is the newest visit and `oldest_store_visit` the oldest of the stores\' latest ones, so a stale balance is visible. This is the stores\' stock, never the central stock.',
  })
  @ApiQuery({ name: 'skus', required: true, description: 'Comma separated' })
  findNetworkBalances(@Query('skus') skus: string) {
    return this.supply.findNetworkBalances((skus ?? '').split(',').map(s => s.trim()).filter(Boolean))
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

  @Get('reports/divergences')
  @ApiOperation({
    summary: 'Units removed under the client-report reason, per visit and SKU, with the SKU previous count',
    description:
      'Read-only. `from`/`to` are inclusive report days (YYYY-MM-DD) matched against the visit end instant that reported the units. ' +
      'The previous conference is the latest earlier visit that COUNTED that SKU in that store (null when none). `unsplit_visits` counts ' +
      'visits in the range whose removal reasons were never stored — their loss is unknown, not zero.',
  })
  @ApiQuery({ name: 'store_ids', required: true, example: '2,3' })
  @ApiQuery({ name: 'from', required: true, example: '2026-05-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-05-11' })
  findDivergences(@Query('store_ids') storeIds: string, @Query('from') from: string, @Query('to') to: string) {
    const ids = [...new Set((storeIds ?? '').split(',').filter(Boolean).map(Number))]
    if (ids.length === 0 || ids.some(id => !Number.isInteger(id) || id <= 0) || !isValidDay(from) || !isValidDay(to) || from > to) {
      throw new BadRequestException('store_ids (positive integers) and from/to (YYYY-MM-DD, from <= to) are required')
    }

    return this.supply.findDivergences(ids, from, to)
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

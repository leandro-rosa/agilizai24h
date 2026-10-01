import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { RefreshService } from './refresh.service'

/**
 * Internal routes (no gateway, no screen in this phase). The monthly refresh normally starts by
 * itself when supply and sales are imported; `POST /refresh` is the manual trigger.
 */
@ApiTags('refresh')
@Controller()
export class RefreshController {
  constructor(private readonly refresh: RefreshService) {}

  @Post('refresh')
  @ApiOperation({
    summary: 'Start the monthly refresh by hand',
    description:
      'Starts one linked set (engine run + backtest) through the latest available month, or through `month` (YYYY-MM, must have ended). ' +
      'Does nothing when that month already has a running or completed set, unless `force` is true (a new set for a completed month). ' +
      'Returns at once; follow it with GET /refresh/status.',
  })
  start(@Body() body: { month?: string; force?: boolean } | undefined, @Headers('x-correlation-id') correlationId?: string) {
    return this.refresh.evaluate({ trigger: 'manual', month: body?.month, force: body?.force === true, correlationId })
  }

  @Get('refresh/status')
  @ApiOperation({
    summary: 'The current set and its freshness',
    description:
      'The current set, any set running, the latest failure and `freshness`: `dataThrough`, `computedAt`, `outOfDate` with `monthsLagged` ' +
      'when a later month is already available, and `pendingImport` for months that ended but are not imported enough yet. ' +
      'A month that is not available is never claimed as covered.',
  })
  status(@Headers('x-correlation-id') correlationId?: string) {
    return this.refresh.status(new Date(), correlationId)
  }

  @Get('refresh/sets')
  @ApiOperation({ summary: 'Every refresh set, newest first, with its period, versions and computation time' })
  sets(@Query('limit') limit?: string) {
    return this.refresh.sets(limit ? Number(limit) : undefined)
  }

  @Get('history/:storeId/:sku')
  @ApiOperation({
    summary: 'The evolution of one Product x Store across completed refresh sets',
    description: 'One entry per completed set, oldest first: the period it covers, engine and parameter versions, computation time and that pair\'s result (null when the pair is absent from that set).',
  })
  history(@Param('storeId', ParseIntPipe) storeId: number, @Param('sku') sku: string) {
    return this.refresh.history(storeId, sku)
  }
}

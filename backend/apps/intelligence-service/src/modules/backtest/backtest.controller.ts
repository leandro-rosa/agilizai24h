import { Body, Controller, Get, Header, Headers, Param, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { BacktestService, type StartBacktestBody } from './backtest.service'

/**
 * Internal routes (no gateway, no screen in this phase). Starting a backtest only
 * records it and queues one job; the replay runs in the worker. Nothing here
 * issues a verdict: the report is read with the owner.
 */
@ApiTags('backtests')
@Controller('backtests')
export class BacktestController {
  constructor(private readonly backtests: BacktestService) {}

  @Post()
  @ApiOperation({
    summary: 'Start a backtest over a range of months',
    description:
      'Records the backtest and queues one job. Origins are every month start from the first with at least eight weeks of history through `dataThrough` ' +
      '(defaults to `rangeTo`). `asOf` defaults to the end of `dataThrough`; the parameter version defaults to the current one. Returns the id at once; poll GET /backtests/:id.',
  })
  start(@Body() body: StartBacktestBody, @Headers('x-correlation-id') correlationId?: string) {
    return this.backtests.startFromBody({ ...body, correlationId })
  }

  @Get()
  @ApiOperation({ summary: 'Recent backtests, newest first' })
  list(@Query('limit') limit?: string) {
    return this.backtests.list(limit ? Number(limit) : undefined)
  }

  @Get(':id')
  @ApiOperation({ summary: 'One backtest: status, versions, parameters used and the stored report (aggregates, coverage, sensitivity). It carries no verdict.' })
  get(@Param('id') id: string) {
    return this.backtests.get(id)
  }

  @Get(':id/summary')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({ summary: 'The stored report as readable plain text' })
  summary(@Param('id') id: string) {
    return this.backtests.summary(id)
  }

  @Get(':id/results')
  @ApiOperation({ summary: 'Per Product x Store outcomes at each origin, filterable by store, SKU, origin, action and coherence class' })
  results(
    @Param('id') id: string,
    @Query('storeId') storeId?: string,
    @Query('sku') sku?: string,
    @Query('origin') origin?: string,
    @Query('action') action?: string,
    @Query('coherence') coherence?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.backtests.results(id, {
      storeId: storeId ? Number(storeId) : undefined,
      sku,
      origin,
      action,
      coherence,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
  }
}

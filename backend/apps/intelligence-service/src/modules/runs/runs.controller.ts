import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { RunsService, type CreateRunInput } from './runs.service'

/**
 * Internal routes (no gateway, no screen in this phase). Starting a run only
 * records it and queues one job per store; the work happens in the worker.
 */
@ApiTags('runs')
@Controller('runs')
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Post()
  @ApiOperation({
    summary: 'Start an engine run over a range of months',
    description:
      'Records the run with the engine and parameter versions and queues one job per store. Returns immediately; ' +
      'poll GET /runs/:id. `asOf` (ISO) is the reference date balance ages are measured from; it defaults to now.',
  })
  create(@Body() body: Partial<CreateRunInput>, @Headers('x-correlation-id') correlationId?: string) {
    return this.runs.create({ rangeFrom: body?.rangeFrom as string, rangeTo: body?.rangeTo as string, asOf: body?.asOf, correlationId })
  }

  @Get()
  @ApiOperation({ summary: 'Recent runs, newest first' })
  list(@Query('limit') limit?: string) {
    return this.runs.list(limit ? Number(limit) : undefined)
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One run: status, versions, per-store outcome (done or skipped with the reason) and the coverage summary',
    description: 'A skipped store is listed with why; it is never counted as zero recommendations.',
  })
  get(@Param('id') id: string) {
    return this.runs.get(id)
  }

  @Get(':id/results')
  @ApiOperation({ summary: 'The results of a run, filterable by store, SKU or coverage category' })
  results(
    @Param('id') id: string,
    @Query('storeId') storeId?: string,
    @Query('sku') sku?: string,
    @Query('coverage') coverage?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.runs.results(id, {
      storeId: storeId ? Number(storeId) : undefined,
      sku,
      coverage,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
  }
}

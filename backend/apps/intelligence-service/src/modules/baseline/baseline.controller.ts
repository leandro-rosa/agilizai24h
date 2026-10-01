import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { BaselineImportService, type BaselineImportInput } from './baseline-import.service'
import { BaselineRepository } from './baseline.repository'

@ApiTags('baselines')
@Controller('baselines')
export class BaselineController {
  constructor(
    private readonly importer: BaselineImportService,
    private readonly baselines: BaselineRepository,
  ) {}

  @Post('import')
  @ApiOperation({
    summary: 'Import baseline quantities and packaging from the pricing sheet',
    description:
      'A DRY RUN unless `apply` is true: it classifies every row (accepted, rejected, conflicting) and writes nothing. ' +
      'A SKU whose rows disagree is a conflict and is not imported unless `resolutions` states the owner\'s choice. ' +
      'History is append-only; an identical re-import adds nothing.',
  })
  import(@Body() body: Partial<BaselineImportInput>) {
    if (!body?.source || typeof body.source !== 'string') throw new BadRequestException('source is required')
    if (!Array.isArray(body.rows)) throw new BadRequestException('rows must be a list')

    return this.importer.run({ ...body, source: body.source, rows: body.rows })
  }

  @Get()
  @ApiOperation({ summary: 'The baseline in force for every SKU' })
  all(@Query('asOf') asOf?: string) {
    return this.baselines.currentForAll(asOf ? new Date(asOf) : new Date())
  }

  @Get(':sku/history')
  @ApiOperation({ summary: 'Every value a SKU\'s baseline has had, oldest first, with its source' })
  history(@Param('sku') sku: string) {
    return this.baselines.history(sku)
  }
}

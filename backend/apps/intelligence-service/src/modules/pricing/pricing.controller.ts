import { BadRequestException, Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { PricingParametersInvalidError } from './pricing.parameters'
import { PricingParametersService, type PricingParametersPatch } from './pricing-parameters.service'
import { PricingService } from './pricing.service'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

function query(period?: string, storeId?: string): { period?: string; storeId?: number } {
  if (period !== undefined && !MONTH.test(period)) throw new BadRequestException('period must be a month, YYYY-MM')
  if (storeId !== undefined && !/^\d+$/.test(storeId)) throw new BadRequestException('storeId must be a positive integer')

  return { period, storeId: storeId === undefined ? undefined : Number(storeId) }
}

/**
 * Internal routes, read-only except for the parameter versions. The engine
 * only recommends: nothing here changes a price or writes to another service.
 */
@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly parameters: PricingParametersService,
  ) {}

  @Get('report')
  @ApiOperation({
    summary: 'Prices, status, confidence and estimated impact for the catalogue',
    description: 'Window of `lookbackMonths` ending at `period` (default: last closed month). Without `storeId` it is the network.',
  })
  @ApiQuery({ name: 'period', required: false, example: '2026-09' })
  @ApiQuery({ name: 'storeId', required: false })
  report(@Query('period') period?: string, @Query('storeId') storeId?: string, @Headers('x-correlation-id') correlationId?: string) {
    return this.pricing.report(query(period, storeId), correlationId)
  }

  @Get('products/:sku')
  @ApiOperation({ summary: 'One product, computed from the same inputs as the report' })
  product(@Param('sku') sku: string, @Query('period') period?: string, @Query('storeId') storeId?: string, @Headers('x-correlation-id') correlationId?: string) {
    return this.pricing.product(sku, query(period, storeId), correlationId)
  }

  @Get('parameters/current')
  @ApiOperation({ summary: 'The latest pricing parameter version' })
  current() {
    return this.parameters.current()
  }

  @Get('parameters/versions')
  @ApiOperation({ summary: 'Every pricing parameter version, newest first' })
  versions() {
    return this.parameters.list()
  }

  @Get('parameters/versions/:id')
  @ApiOperation({ summary: 'One historical version, with the values in force then' })
  version(@Param('id', ParseIntPipe) id: number) {
    return this.parameters.byId(id)
  }

  @Post('parameters')
  @ApiOperation({
    summary: 'Create a new pricing parameter version from the current one plus a partial change',
    description: 'Validated as a whole; an earlier version is never edited. Payment fees and loss rates are not parameters here.',
  })
  async create(@Body() body: { values?: PricingParametersPatch; note?: string }) {
    if (!body?.values || typeof body.values !== 'object') throw new BadRequestException('values is required')

    try {
      return await this.parameters.createVersion(body.values, body.note)
    } catch (error) {
      if (error instanceof PricingParametersInvalidError) throw new BadRequestException({ message: error.message, problems: error.problems })
      throw error
    }
  }
}

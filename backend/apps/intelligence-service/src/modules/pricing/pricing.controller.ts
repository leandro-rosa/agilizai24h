import { BadRequestException, Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { NewProductChoiceService } from './new-product-choice.service'
import { PricingParametersInvalidError } from './pricing.parameters'
import { PricingParametersService, type PricingParametersPatch } from './pricing-parameters.service'
import { PricingDecisionsService, type RecordDecisionInput } from './pricing-decisions.service'
import { PricingProductService } from './pricing-product.service'
import { PricingRunsService } from './pricing-runs.service'
import { InvalidPriceError } from './simulate'
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
    private readonly runs: PricingRunsService,
    private readonly productService: PricingProductService,
    private readonly decisions: PricingDecisionsService,
    private readonly choices: NewProductChoiceService,
  ) {}

  @Post('runs')
  @ApiOperation({
    summary: 'Start a pricing report run for a period and a scope',
    description: 'Runs in the background. A run already in progress for the scope is returned instead of starting a second.',
  })
  startRun(@Body() body: { period?: string; storeId?: number | null }, @Headers('x-correlation-id') correlationId?: string) {
    return this.runs.start({ period: body?.period, storeId: body?.storeId, correlationId })
  }

  @Get('runs/latest')
  @ApiOperation({
    summary: 'The latest completed report of a scope, without recomputing',
    description: '`state: none` when the scope never completed a run; it is never an empty report.',
  })
  @ApiQuery({ name: 'period', required: false, example: '2026-09' })
  @ApiQuery({ name: 'storeId', required: false })
  latest(@Query('period') period?: string, @Query('storeId') storeId?: string) {
    const parsed = query(period, storeId)

    return this.runs.latest({ period: parsed.period, storeId: parsed.storeId })
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Status of one run (no report)' })
  run(@Param('id') id: string) {
    return this.runs.get(id)
  }

  @Get('report')
  @ApiOperation({
    summary: 'Computes the report in the request (internal; the screen reads stored runs)',
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

  @Get('products/:sku/history')
  @ApiOperation({
    summary: 'Monthly cost, price, product margin and markup of one product, with change flags',
    description: 'The margin is the product margin (price − cost) / price, not the engine\'s economic margin. A month with no cost or price has empty values, not zero.',
  })
  @ApiQuery({ name: 'period', required: false, example: '2026-09' })
  @ApiQuery({ name: 'months', required: false, example: 12 })
  history(@Param('sku') sku: string, @Query('period') period?: string, @Query('months') months?: string, @Headers('x-correlation-id') correlationId?: string) {
    if (months !== undefined && !/^\d+$/.test(months)) throw new BadRequestException('months must be a positive integer')

    return this.productService.history(sku, { period: query(period).period, months: months === undefined ? undefined : Number(months) }, correlationId)
  }

  @Post('products/:sku/simulate')
  @ApiOperation({
    summary: 'Simulate a typed price over the stored cost structure',
    description: 'Estimate only; writes nothing. 409 when the scope has no stored report; `simulable: false` for a product without a structure.',
  })
  async simulate(@Param('sku') sku: string, @Body() body: { priceCents?: unknown; period?: string; storeId?: number | null }) {
    if (body?.period !== undefined) query(body.period)

    try {
      return await this.productService.simulate(sku, { priceCents: body?.priceCents, period: body?.period, storeId: body?.storeId })
    } catch (error) {
      if (error instanceof InvalidPriceError) throw new BadRequestException(error.message)
      throw error
    }
  }

  @Get('products/:sku/stores')
  @ApiOperation({ summary: 'Each store\'s units, revenue, loss and estimated margin of one product' })
  @ApiQuery({ name: 'period', required: false, example: '2026-09' })
  stores(@Param('sku') sku: string, @Query('period') period?: string, @Headers('x-correlation-id') correlationId?: string) {
    return this.productService.storesOf(sku, { period: query(period).period }, correlationId)
  }

  @Get('new-product/:sku')
  @ApiOperation({
    summary: 'A price suggestion for a product with no price and no sales history (same engine, same parameters)',
    description:
      'Suggests, never writes. `costCents` is the invoice cost when the purchase is not received yet (no cost version exists then); `costNotReceived=true` says so in the answer. Labelled "Produto novo — sem histórico de vendas", confidence never above low, with the data it used.',
  })
  newProduct(
    @Param('sku') sku: string,
    @Query('costCents') costCents?: string,
    @Query('costOrigin') costOrigin?: string,
    @Query('costNotReceived') costNotReceived?: string,
    @Query('period') period?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const cost = costCents === undefined ? undefined : Number(costCents)
    if (cost !== undefined && !(Number.isInteger(cost) && cost > 0)) throw new BadRequestException('costCents must be a positive whole number of centavos')

    return this.pricing.newProduct(sku, { costCents: cost, costOrigin, costNotReceived: costNotReceived === 'true', period }, correlationId)
  }

  @Post('new-product/:sku/choice')
  @ApiOperation({
    summary: 'Record what was chosen for a new product\'s price: used the suggestion, typed another, or saved without a price',
    description: 'An audit only: it never writes a price. The suggestion is recomputed on the server; "used the suggestion" is refused when the price differs from it, and a typed price needs a reason. The gateway sets `actor` and, when a price was written, `decisionId`.',
  })
  recordChoice(@Param('sku') sku: string, @Body() body: Record<string, unknown>, @Headers('x-correlation-id') correlationId?: string) {
    return this.choices.record({ ...body, sku, correlationId })
  }

  @Get('new-product/:sku/choices')
  @ApiOperation({ summary: 'The recorded price choices of a product registered from an invoice, newest first' })
  choicesOf(@Param('sku') sku: string) {
    return this.choices.list(sku)
  }

  @Post('decisions')
  @ApiOperation({
    summary: 'Record a pending price decision (does NOT change any price)',
    description:
      'The previous price and the engine recommendation are taken on the server. The same idempotency key returns the decision already recorded. The gateway writes the price and then closes the decision.',
  })
  async recordDecision(@Body() body: RecordDecisionInput, @Headers('x-correlation-id') correlationId?: string) {
    return this.decisions.record({ ...body, correlationId })
  }

  @Post('decisions/:id/applied')
  @ApiOperation({ summary: 'Close a decision as applied (the price was written)' })
  markApplied(@Param('id') id: string) {
    return this.decisions.markApplied(id)
  }

  @Post('decisions/:id/failed')
  @ApiOperation({ summary: 'Close a decision as failed (the price was not changed)' })
  markFailed(@Param('id') id: string, @Body() body: { error?: string }) {
    return this.decisions.markFailed(id, body?.error ?? 'unknown error')
  }

  /** Declared before `decisions/:id…` is irrelevant (no GET by id); `pending` and the list are the reads. */
  @Get('decisions/pending')
  @ApiOperation({ summary: 'Decisions still pending after N minutes: a price write that may have half-failed' })
  @ApiQuery({ name: 'olderThanMinutes', required: false, example: 5 })
  pending(@Query('olderThanMinutes') minutes?: string) {
    if (minutes !== undefined && !/^\d+$/.test(minutes)) throw new BadRequestException('olderThanMinutes must be a positive integer')

    return this.decisions.stalePending(minutes === undefined ? undefined : Number(minutes))
  }

  @Get('decisions')
  @ApiOperation({ summary: 'Price decisions, newest first, optionally of one product' })
  @ApiQuery({ name: 'sku', required: false })
  @ApiQuery({ name: 'limit', required: false })
  listDecisions(@Query('sku') sku?: string, @Query('limit') limit?: string) {
    if (limit !== undefined && !/^\d+$/.test(limit)) throw new BadRequestException('limit must be a positive integer')

    return this.decisions.list({ sku, limit: limit === undefined ? undefined : Number(limit) })
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

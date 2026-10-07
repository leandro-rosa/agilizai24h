import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { Caller } from '../../auth/guards/caller.decorator'
import { RequiresPermission } from '../../auth/guards/session.constants'
import type { AuthenticatedCaller } from '../../auth/services/session.service'
import { DomainClient } from '../../upstream/domain.client'
import { PricingApplyService } from '../pricing-apply.service'
import { correlationOf } from './stores.controller'

/**
 * Smart pricing (intelligence-service). The engine only recommends: the one route that changes a price is
 * `POST /pricing/decisions/apply`, which needs the product write permission and records who did it. Reads use the
 * product read permission, since the figures are the margin of the catalogue. The report is read from a stored run;
 * nothing here computes it in the request.
 */
@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly domains: DomainClient,
    private readonly applier: PricingApplyService,
  ) {}

  @Post('runs')
  @HttpCode(202)
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Start a pricing report run for a period and a scope (runs in the background)' })
  async startRun(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.send('post', '/pricing/runs', request, body)
  }

  @Get('runs/latest')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'The latest completed report of a scope, without recomputing' })
  @ApiQuery({ name: 'period', required: false, example: '2026-09' })
  @ApiQuery({ name: 'storeId', required: false })
  async latest(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return this.get('/pricing/runs/latest', query, request)
  }

  @Get('runs/:id')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Status of one run' })
  async run(@Param('id') id: string, @Req() request: FastifyRequest) {
    return this.get(`/pricing/runs/${encodeURIComponent(id)}`, {}, request)
  }

  @Get('products/:sku/history')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Monthly cost, price, product margin and markup of one product' })
  async history(@Param('sku') sku: string, @Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return this.get(`/pricing/products/${encodeURIComponent(sku)}/history`, query, request)
  }

  @Get('products/:sku/stores')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Each store\'s units, revenue, loss and estimated margin of one product' })
  async stores(@Param('sku') sku: string, @Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return this.get(`/pricing/products/${encodeURIComponent(sku)}/stores`, query, request)
  }

  /** Reads only: simulating writes nothing, so it needs no more than the read permission. */
  @Post('products/:sku/simulate')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Simulate a typed price over the stored cost structure (estimate; changes nothing)' })
  async simulate(@Param('sku') sku: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.send('post', `/pricing/products/${encodeURIComponent(sku)}/simulate`, request, body)
  }

  @Get('decisions')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Price decisions, newest first, optionally of one product' })
  async decisions(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return this.get('/pricing/decisions', query, request)
  }

  /** Declared before any `decisions/:id` route: "pending" must not be read as an id. */
  @Get('decisions/pending')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Decisions still pending after a few minutes: a price write that may have half-failed' })
  async pending(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return this.get('/pricing/decisions/pending', query, request)
  }

  @Get('new-product/:sku')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'A price suggestion for a product with no price and no sales history (same engine and parameters); suggests, never writes' })
  async newProduct(@Param('sku') sku: string, @Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return this.get(`/pricing/new-product/${encodeURIComponent(sku)}`, query, request)
  }

  @Get('new-product/:sku/choices')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'What was chosen for the price of a product registered from an invoice' })
  async newProductChoices(@Param('sku') sku: string, @Req() request: FastifyRequest) {
    return this.get(`/pricing/new-product/${encodeURIComponent(sku)}/choices`, {}, request)
  }

  @Post('new-product/:sku/choice')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({
    summary: 'Choose the price of a product registered from an invoice: use the suggestion, type another, or save without a price',
    description: 'The actor is the logged-in user. The choice is recorded first; a chosen price is then written like any approved price. Without a price, nothing is written.',
  })
  async chooseNewProductPrice(@Param('sku') sku: string, @Body() body: Record<string, unknown>, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    return this.applier.chooseForNewProduct(sku, body ?? {}, caller.email, correlationOf(request))
  }

  @Post('decisions/apply')
  @HttpCode(200)
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({
    summary: 'Approve a price: record the decision, write the price, close the decision',
    description: 'The actor is the logged-in user. The same idempotency key is one decision and one price write.',
  })
  async apply(@Body() body: Record<string, unknown>, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    return this.applier.apply(body ?? {}, caller.email, correlationOf(request))
  }

  @Get('parameters/current')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'The latest pricing parameter version' })
  async currentParameters(@Req() request: FastifyRequest) {
    return this.get('/pricing/parameters/current', {}, request)
  }

  @Get('parameters/versions')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Every pricing parameter version' })
  async parameterVersions(@Req() request: FastifyRequest) {
    return this.get('/pricing/parameters/versions', {}, request)
  }

  @Get('parameters/versions/:id')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'One historical pricing parameter version' })
  async parameterVersion(@Param('id') id: string, @Req() request: FastifyRequest) {
    return this.get(`/pricing/parameters/versions/${encodeURIComponent(id)}`, {}, request)
  }

  @Post('parameters')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Create a new pricing parameter version (target margin, tax rate, rounding, ...)' })
  async createParameters(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.send('post', '/pricing/parameters', request, body)
  }

  private async get(path: string, query: Record<string, string>, request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.intelligence({ method: 'get', path: `${path}${search ? `?${search}` : ''}`, correlationId: correlationOf(request) })

    return result.data
  }

  private async send(method: 'post', path: string, request: FastifyRequest, payload: unknown) {
    const result = await this.domains.intelligence({ method, path, payload, correlationId: correlationOf(request) })

    return result.data
  }
}

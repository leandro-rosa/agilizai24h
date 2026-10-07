import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { DomainClient } from '../../upstream/domain.client'
import { correlationOf } from './stores.controller'

/**
 * Smart pricing (intelligence-service). The engine only recommends: there is
 * no route here that changes a product price. Reads use the product
 * permission, since the figures are the margin of the catalogue.
 */
@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(private readonly domains: DomainClient) {}

  @Get('report')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Recommended prices, status, confidence and estimated impact for the catalogue' })
  @ApiQuery({ name: 'period', required: false, example: '2026-09' })
  @ApiQuery({ name: 'storeId', required: false })
  async report(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return this.get('/pricing/report', query, request)
  }

  @Get('products/:sku')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'One product, from the same inputs as the report' })
  async product(@Param('sku') sku: string, @Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return this.get(`/pricing/products/${encodeURIComponent(sku)}`, query, request)
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

  @Post('parameters')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Create a new pricing parameter version (target margin, tax rate, rounding, ...)' })
  async createParameters(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.intelligence({ method: 'post', path: '/pricing/parameters', payload: body, correlationId: correlationOf(request) })

    return result.data
  }

  private async get(path: string, query: Record<string, string>, request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.intelligence({ method: 'get', path: `${path}${search ? `?${search}` : ''}`, correlationId: correlationOf(request) })

    return result.data
  }
}

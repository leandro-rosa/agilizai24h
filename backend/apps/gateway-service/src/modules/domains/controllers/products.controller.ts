import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { DomainClient } from '../../upstream/domain.client'
import { correlationOf } from './stores.controller'

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly domains: DomainClient) {}

  @Get()
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'List catalogue products' })
  async list(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.products({
      method: 'get',
      path: `/products${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get(':id')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Retrieve one product' })
  async findById(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'get',
      path: `/products/${encodeURIComponent(id)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post()
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Create a product' })
  async create(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'post',
      path: '/products',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post(':sku/costs')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Record a cost effective from a date' })
  async recordCost(@Param('sku') sku: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'post',
      path: `/products/${encodeURIComponent(sku)}/costs`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}

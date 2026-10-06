import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common'
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

  @Patch(':id')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Update a product' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'patch',
      path: `/products/${encodeURIComponent(id)}`,
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

  @Get(':id/costs')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'A product cost history' })
  async listCosts(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'get',
      path: `/products/${encodeURIComponent(id)}/costs`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('costs/bulk')
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({
    summary: 'Costs for a set of SKUs as of a date',
    description: 'There is deliberately no lookup that returns a "current" cost without a date.',
  })
  async bulkCosts(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.products({
      method: 'post',
      path: '/costs/bulk',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}

/**
 * Decisões do operador sobre pares de SKU (troca de código de barras). Rota
 * própria (`/sku-links`) para não colidir com `products/:id`.
 */
@ApiTags('products')
@Controller('sku-links')
export class SkuLinksController {
  constructor(private readonly domains: DomainClient) {}

  @Get()
  @RequiresPermission(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Operator decisions on SKU pairs' })
  async list(@Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'get', path: '/sku-links', correlationId: correlationOf(request) })

    return result.data
  }

  @Put()
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Confirm or reject that a new SKU is the same product as an old one' })
  async decide(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'put', path: '/sku-links', payload: body, correlationId: correlationOf(request) })

    return result.data
  }

  @Delete(':id')
  @RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Undo a decision' })
  async remove(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.products({ method: 'delete', path: `/sku-links/${encodeURIComponent(id)}`, correlationId: correlationOf(request) })

    return result.data
  }
}

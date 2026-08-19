import { Body, Controller, Get, Param, ParseIntPipe, Put, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { DomainClient } from '../../upstream/domain.client'
import { correlationOf } from './stores.controller'

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly domains: DomainClient) {}

  @Get(':storeId')
  @RequiresPermission(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Derived stock for a store, as of a period or the latest known one' })
  @ApiQuery({ name: 'period', required: false, example: '2026-03' })
  async stockForStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query('period') period: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.domains.inventory({
      method: 'get',
      path: `/inventory/${storeId}${period ? `?period=${encodeURIComponent(period)}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get(':storeId/below-minimum')
  @RequiresPermission(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'SKUs at or below their configured minimum' })
  @ApiQuery({ name: 'period', required: false })
  async belowMinimum(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query('period') period: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.domains.inventory({
      method: 'get',
      path: `/inventory/${storeId}/below-minimum${period ? `?period=${encodeURIComponent(period)}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get(':storeId/minimums')
  @RequiresPermission(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Configured minimum levels for a store' })
  async listMinimums(@Param('storeId', ParseIntPipe) storeId: number, @Req() request: FastifyRequest) {
    const result = await this.domains.inventory({
      method: 'get',
      path: `/inventory/${storeId}/minimums`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Put(':storeId/:sku/minimum')
  @RequiresPermission(PERMISSIONS.INVENTORY_WRITE)
  @ApiOperation({ summary: 'Configure a minimum level for a store and SKU' })
  async setMinimum(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Param('sku') sku: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.domains.inventory({
      method: 'put',
      path: `/inventory/${storeId}/${encodeURIComponent(sku)}/minimum`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}

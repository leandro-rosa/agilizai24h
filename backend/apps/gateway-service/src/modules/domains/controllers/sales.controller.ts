import { Controller, Get, Param, ParseIntPipe, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { DomainClient } from '../../upstream/domain.client'
import { correlationOf } from './stores.controller'

@ApiTags('sales')
@Controller('sales')
export class SalesController {
  constructor(private readonly domains: DomainClient) {}

  @Get(':storeId')
  @RequiresPermission(PERMISSIONS.SALES_READ)
  @ApiOperation({ summary: 'Sales rows for a store and period — one row per SKU' })
  @ApiQuery({ name: 'period', required: true, example: '2026-03' })
  async findPeriod(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query('period') period: string,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.domains.sales({
      method: 'get',
      path: `/sales/${storeId}?period=${encodeURIComponent(period)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get(':storeId/totals')
  @RequiresPermission(PERMISSIONS.SALES_READ)
  @ApiOperation({ summary: 'Aggregated sales totals for a store and period' })
  @ApiQuery({ name: 'period', required: true, example: '2026-03' })
  async totals(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query('period') period: string,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.domains.sales({
      method: 'get',
      path: `/sales/${storeId}/totals?period=${encodeURIComponent(period)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}

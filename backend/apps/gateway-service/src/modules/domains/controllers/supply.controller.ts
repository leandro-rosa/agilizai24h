import { Controller, Get, Param, ParseIntPipe, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { DomainClient } from '../../upstream/domain.client'
import { correlationOf } from './stores.controller'

@ApiTags('supply')
@Controller('supply')
export class SupplyController {
  constructor(private readonly domains: DomainClient) {}

  @Get('reasons')
  @RequiresPermission(PERMISSIONS.SUPPLY_READ)
  @ApiOperation({ summary: 'The removal reasons and their loss classification' })
  async listReasons(@Req() request: FastifyRequest) {
    const result = await this.domains.supply({
      method: 'get',
      path: '/reasons',
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get(':storeId')
  @RequiresPermission(PERMISSIONS.SUPPLY_READ)
  @ApiOperation({ summary: 'Restocks and per-reason removals for a store and period' })
  @ApiQuery({ name: 'period', required: true, example: '2026-03' })
  async findPeriod(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query('period') period: string,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.domains.supply({
      method: 'get',
      path: `/supply/${storeId}?period=${encodeURIComponent(period)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get(':storeId/loss')
  @RequiresPermission(PERMISSIONS.SUPPLY_READ)
  @ApiOperation({ summary: 'Real loss for a store and period — total, by reason, by SKU' })
  @ApiQuery({ name: 'period', required: true, example: '2026-03' })
  async findLoss(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query('period') period: string,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.domains.supply({
      method: 'get',
      path: `/supply/${storeId}/loss?period=${encodeURIComponent(period)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}

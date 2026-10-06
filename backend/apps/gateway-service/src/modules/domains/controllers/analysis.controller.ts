import { Controller, Get, Param, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { DomainClient } from '../../upstream/domain.client'
import { correlationOf } from './stores.controller'

/** Supplier / product analysis (intelligence-service). Read-only; the same permission as the supply data it is built from. */
@ApiTags('analysis')
@Controller('analysis')
export class AnalysisController {
  constructor(private readonly domains: DomainClient) {}

  @Get('suppliers/:id')
  @RequiresPermission(PERMISSIONS.SUPPLY_READ)
  @ApiOperation({ summary: 'Movement, comparison, evolution and insights of one supplier' })
  @ApiQuery({ name: 'period', required: true, example: '2026-10' })
  @ApiQuery({ name: 'compareTo', required: false, enum: ['prev_month', 'avg_3m'] })
  async supplier(@Param('id') id: string, @Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return this.forward(`/analysis/suppliers/${encodeURIComponent(id)}`, query, request)
  }

  @Get('products/:sku')
  @RequiresPermission(PERMISSIONS.SUPPLY_READ)
  @ApiOperation({ summary: 'Movement, per-store performance, evolution and insights of one product' })
  @ApiQuery({ name: 'period', required: true, example: '2026-10' })
  @ApiQuery({ name: 'compareTo', required: false, enum: ['prev_month', 'avg_3m'] })
  async product(@Param('sku') sku: string, @Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return this.forward(`/analysis/products/${encodeURIComponent(sku)}`, query, request)
  }

  @Get('cross')
  @RequiresPermission(PERMISSIONS.SUPPLY_READ)
  @ApiOperation({ summary: 'One product as bought from one supplier (declared link only)' })
  async cross(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return this.forward('/analysis/cross', query, request)
  }

  private async forward(path: string, query: Record<string, string>, request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.intelligence({ method: 'get', path: `${path}${search ? `?${search}` : ''}`, correlationId: correlationOf(request) })

    return result.data
  }
}

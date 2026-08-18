import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { DomainClient } from '../../upstream/domain.client'
import { correlationOf } from './stores.controller'

/**
 * The monthly reconciliation, read by the panel.
 *
 * Recompute is behind `finance:read` rather than a write permission on purpose:
 * it creates nothing an operator did not already have the right to see — it
 * only re-derives figures from data they can already read — and the operators
 * who need it after a cost correction hold no write rights anywhere.
 */
@ApiTags('finance')
@Controller('finance')
export class FinanceController {
  constructor(private readonly domains: DomainClient) {}

  @Get('rollup')
  @RequiresPermission(PERMISSIONS.FINANCE_READ)
  @ApiOperation({ summary: 'Network total for a month, with its completeness statement' })
  @ApiQuery({ name: 'period', required: true, example: '2026-03' })
  async rollup(@Query('period') period: string, @Req() request: FastifyRequest) {
    const result = await this.domains.finance({
      method: 'get',
      path: `/finance/rollup?period=${encodeURIComponent(period ?? '')}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get(':storeId')
  @RequiresPermission(PERMISSIONS.FINANCE_READ)
  @ApiOperation({ summary: 'Every reconciled month for a store' })
  async series(@Param('storeId') storeId: string, @Req() request: FastifyRequest) {
    const result = await this.domains.finance({
      method: 'get',
      path: `/finance/${encodeURIComponent(storeId)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get(':storeId/:period')
  @RequiresPermission(PERMISSIONS.FINANCE_READ)
  @ApiOperation({ summary: "One store's month: the four figures, the loss breakdowns and what could not be valued" })
  async findOne(
    @Param('storeId') storeId: string,
    @Param('period') period: string,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.domains.finance({
      method: 'get',
      path: `/finance/${encodeURIComponent(storeId)}/${encodeURIComponent(period)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post(':storeId/:period/recompute')
  @RequiresPermission(PERMISSIONS.FINANCE_READ)
  @ApiOperation({ summary: 'Recompute a store-month — for backfills and cost corrections, which produce no event' })
  async recompute(
    @Param('storeId') storeId: string,
    @Param('period') period: string,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.domains.finance({
      method: 'post',
      path: `/finance/${encodeURIComponent(storeId)}/${encodeURIComponent(period)}/recompute`,
      // An explicit empty body: @app/http-client sets `content-type:
      // application/json` on every POST, and Fastify rejects that header with
      // no body at all.
      payload: {},
      correlationId: correlationOf(request),
    })

    return result.data
  }
}

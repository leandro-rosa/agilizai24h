import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { DomainClient } from '../../upstream/domain.client'
import { correlationOf } from './stores.controller'

/**
 * Explicit routes, not a transparent proxy — same reason as every other
 * domain controller here: a pass-through would make each endpoint implicitly
 * public the moment it is written, and the permission a route requires would
 * live nowhere.
 */
@ApiTags('accounting')
@Controller('accounting')
export class AccountingController {
  constructor(private readonly domains: DomainClient) {}

  @Get('accounts')
  @RequiresPermission(PERMISSIONS.ACCOUNTING_READ)
  @ApiOperation({ summary: 'List the chart of accounts' })
  async getAccounts(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.accounting({
      method: 'get',
      path: `/accounting/accounts${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('accounts')
  @RequiresPermission(PERMISSIONS.ACCOUNTING_WRITE)
  @ApiOperation({ summary: 'Add an account line' })
  async postAccounts(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.accounting({
      method: 'post',
      path: '/accounting/accounts',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch('accounts/:id')
  @RequiresPermission(PERMISSIONS.ACCOUNTING_WRITE)
  @ApiOperation({ summary: 'Update an account line' })
  async patchAccountsById(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.accounting({
      method: 'patch',
      path: `/accounting/accounts/${encodeURIComponent(id)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('entries')
  @RequiresPermission(PERMISSIONS.ACCOUNTING_READ)
  @ApiOperation({ summary: 'List ledger entries' })
  async getEntries(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.accounting({
      method: 'get',
      path: `/accounting/entries${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Put('entries')
  @RequiresPermission(PERMISSIONS.ACCOUNTING_WRITE)
  @ApiOperation({ summary: 'Set one account for one period' })
  async putEntries(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.accounting({
      method: 'put',
      path: '/accounting/entries',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Delete('entries/:id')
  @RequiresPermission(PERMISSIONS.ACCOUNTING_WRITE)
  @ApiOperation({ summary: 'Remove a ledger entry' })
  async deleteEntriesById(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.accounting({
      method: 'delete',
      path: `/accounting/entries/${encodeURIComponent(id)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('cash-flow')
  @RequiresPermission(PERMISSIONS.ACCOUNTING_READ)
  @ApiOperation({ summary: 'Cash flow over a range' })
  async getCashFlow(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.accounting({
      method: 'get',
      path: `/accounting/cash-flow${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Put('cash-flow')
  @RequiresPermission(PERMISSIONS.ACCOUNTING_WRITE)
  @ApiOperation({ summary: 'Record a cash flow period' })
  async putCashFlow(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.accounting({
      method: 'put',
      path: '/accounting/cash-flow',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('pnl/series')
  @RequiresPermission(PERMISSIONS.ACCOUNTING_READ)
  @ApiOperation({ summary: 'P&L snapshots over a range' })
  async getPnlSeries(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.accounting({
      method: 'get',
      path: `/accounting/pnl/series${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('pnl/:period/compute')
  @RequiresPermission(PERMISSIONS.ACCOUNTING_WRITE)
  @ApiOperation({ summary: 'Freeze the period' })
  async postPnlByPeriodCompute(@Param('period') period: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.accounting({
      method: 'post',
      path: `/accounting/pnl/${encodeURIComponent(period)}/compute`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('pnl/:period')
  @RequiresPermission(PERMISSIONS.ACCOUNTING_READ)
  @ApiOperation({ summary: 'The P&L tree for a period' })
  async getPnlByPeriod(@Param('period') period: string, @Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.accounting({
      method: 'get',
      path: `/accounting/pnl/${encodeURIComponent(period)}${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}

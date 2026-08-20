import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
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
@ApiTags('treasury')
@Controller('treasury')
export class TreasuryController {
  constructor(private readonly domains: DomainClient) {}

  @Get('accounts')
  @RequiresPermission(PERMISSIONS.TREASURY_READ)
  @ApiOperation({ summary: 'List bank and card accounts' })
  async getAccounts(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.treasury({
      method: 'get',
      path: `/treasury/accounts${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('accounts')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Register an account' })
  async postAccounts(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'post',
      path: '/treasury/accounts',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch('accounts/:id')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Update an account' })
  async patchAccountsById(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'patch',
      path: `/treasury/accounts/${encodeURIComponent(id)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('mappings')
  @RequiresPermission(PERMISSIONS.TREASURY_READ)
  @ApiOperation({ summary: 'List counterparty rules' })
  async getMappings(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.treasury({
      method: 'get',
      path: `/treasury/mappings${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('mappings')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Create a counterparty rule' })
  async postMappings(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'post',
      path: '/treasury/mappings',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('mappings/apply/:period')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Apply the rules to a period' })
  async postMappingsApplyByPeriod(@Param('period') period: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'post',
      path: `/treasury/mappings/apply/${encodeURIComponent(period)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch('mappings/:id')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Update a counterparty rule' })
  async patchMappingsById(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'patch',
      path: `/treasury/mappings/${encodeURIComponent(id)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Delete('mappings/:id')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Drop a counterparty rule' })
  async deleteMappingsById(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'delete',
      path: `/treasury/mappings/${encodeURIComponent(id)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('fees')
  @RequiresPermission(PERMISSIONS.TREASURY_READ)
  @ApiOperation({ summary: 'List acquirer fees' })
  async getFees(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.treasury({
      method: 'get',
      path: `/treasury/fees${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('fees')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Register an acquirer fee' })
  async postFees(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'post',
      path: '/treasury/fees',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('settlements')
  @RequiresPermission(PERMISSIONS.TREASURY_READ)
  @ApiOperation({ summary: 'List settlement receipts' })
  async getSettlements(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.treasury({
      method: 'get',
      path: `/treasury/settlements${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('settlements')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Record a settlement receipt' })
  async postSettlements(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'post',
      path: '/treasury/settlements',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('transactions/summary')
  @RequiresPermission(PERMISSIONS.TREASURY_READ)
  @ApiOperation({ summary: 'Totals by nature and category' })
  async getTransactionsSummary(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.treasury({
      method: 'get',
      path: `/treasury/transactions/summary${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('transactions')
  @RequiresPermission(PERMISSIONS.TREASURY_READ)
  @ApiOperation({ summary: 'List transactions' })
  async getTransactions(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.treasury({
      method: 'get',
      path: `/treasury/transactions${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('transactions')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Record a transaction' })
  async postTransactions(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'post',
      path: '/treasury/transactions',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch('transactions/:id')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Correct a transaction' })
  async patchTransactionsById(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'patch',
      path: `/treasury/transactions/${encodeURIComponent(id)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Delete('transactions/:id')
  @RequiresPermission(PERMISSIONS.TREASURY_WRITE)
  @ApiOperation({ summary: 'Delete a transaction' })
  async deleteTransactionsById(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.treasury({
      method: 'delete',
      path: `/treasury/transactions/${encodeURIComponent(id)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}

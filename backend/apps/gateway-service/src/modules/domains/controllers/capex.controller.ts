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
@ApiTags('capex')
@Controller('capex')
export class CapexController {
  constructor(private readonly domains: DomainClient) {}

  @Get('investments/payback')
  @RequiresPermission(PERMISSIONS.CAPEX_READ)
  @ApiOperation({ summary: 'Payback per store' })
  async getInvestmentsPayback(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.capex({
      method: 'get',
      path: `/capex/investments/payback${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('investments')
  @RequiresPermission(PERMISSIONS.CAPEX_READ)
  @ApiOperation({ summary: 'List store investments' })
  async getInvestments(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.capex({
      method: 'get',
      path: `/capex/investments${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Put('investments')
  @RequiresPermission(PERMISSIONS.CAPEX_WRITE)
  @ApiOperation({ summary: 'Set reference revenue and profit' })
  async putInvestments(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.capex({
      method: 'put',
      path: '/capex/investments',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('investments/:storeId/recompute')
  @RequiresPermission(PERMISSIONS.CAPEX_WRITE)
  @ApiOperation({ summary: 'Re-sum items and re-derive payback' })
  async postInvestmentsByStoreidRecompute(@Param('storeId') storeId: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.capex({
      method: 'post',
      path: `/capex/investments/${encodeURIComponent(storeId)}/recompute`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('investments/:storeId')
  @RequiresPermission(PERMISSIONS.CAPEX_READ)
  @ApiOperation({ summary: 'One store investment with its items' })
  async getInvestmentsByStoreid(@Param('storeId') storeId: string, @Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.capex({
      method: 'get',
      path: `/capex/investments/${encodeURIComponent(storeId)}${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('items')
  @RequiresPermission(PERMISSIONS.CAPEX_READ)
  @ApiOperation({ summary: 'List investment items' })
  async getItems(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.capex({
      method: 'get',
      path: `/capex/items${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('items')
  @RequiresPermission(PERMISSIONS.CAPEX_WRITE)
  @ApiOperation({ summary: 'Record an investment item' })
  async postItems(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.capex({
      method: 'post',
      path: '/capex/items',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch('items/:id')
  @RequiresPermission(PERMISSIONS.CAPEX_WRITE)
  @ApiOperation({ summary: 'Update an investment item' })
  async patchItemsById(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.capex({
      method: 'patch',
      path: `/capex/items/${encodeURIComponent(id)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Delete('items/:id')
  @RequiresPermission(PERMISSIONS.CAPEX_WRITE)
  @ApiOperation({ summary: 'Remove an investment item' })
  async deleteItemsById(@Param('id') id: string, @Req() request: FastifyRequest) {
    const result = await this.domains.capex({
      method: 'delete',
      path: `/capex/items/${encodeURIComponent(id)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('investors/summary')
  @RequiresPermission(PERMISSIONS.CAPEX_READ)
  @ApiOperation({ summary: 'Committed vs. contributed' })
  async getInvestorsSummary(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.capex({
      method: 'get',
      path: `/capex/investors/summary${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('investors')
  @RequiresPermission(PERMISSIONS.CAPEX_READ)
  @ApiOperation({ summary: 'List investors' })
  async getInvestors(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.capex({
      method: 'get',
      path: `/capex/investors${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('investors')
  @RequiresPermission(PERMISSIONS.CAPEX_WRITE)
  @ApiOperation({ summary: 'Register an investor' })
  async postInvestors(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.capex({
      method: 'post',
      path: '/capex/investors',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('investors/:id')
  @RequiresPermission(PERMISSIONS.CAPEX_READ)
  @ApiOperation({ summary: 'One investor with contributions' })
  async getInvestorsById(@Param('id') id: string, @Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.capex({
      method: 'get',
      path: `/capex/investors/${encodeURIComponent(id)}${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch('investors/:id')
  @RequiresPermission(PERMISSIONS.CAPEX_WRITE)
  @ApiOperation({ summary: 'Update an investor' })
  async patchInvestorsById(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.capex({
      method: 'patch',
      path: `/capex/investors/${encodeURIComponent(id)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('investors/:id/contributions')
  @RequiresPermission(PERMISSIONS.CAPEX_WRITE)
  @ApiOperation({ summary: 'Record a contribution' })
  async postInvestorsByIdContributions(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.capex({
      method: 'post',
      path: `/capex/investors/${encodeURIComponent(id)}/contributions`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Delete('investors/:id/contributions/:contributionId')
  @RequiresPermission(PERMISSIONS.CAPEX_WRITE)
  @ApiOperation({ summary: 'Remove a contribution' })
  async deleteInvestorsByIdContributionsByContributionid(@Param('id') id: string, @Param('contributionId') contributionId: string, @Req() request: FastifyRequest) {
    const result = await this.domains.capex({
      method: 'delete',
      path: `/capex/investors/${encodeURIComponent(id)}/contributions/${encodeURIComponent(contributionId)}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}

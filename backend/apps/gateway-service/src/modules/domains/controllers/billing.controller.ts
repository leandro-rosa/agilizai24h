import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
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
@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly domains: DomainClient) {}

  @Get('clients')
  @RequiresPermission(PERMISSIONS.BILLING_READ)
  @ApiOperation({ summary: 'List clients' })
  async getClients(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.billing({
      method: 'get',
      path: `/billing/clients${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('clients')
  @RequiresPermission(PERMISSIONS.BILLING_WRITE)
  @ApiOperation({ summary: 'Create a client' })
  async postClients(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.billing({
      method: 'post',
      path: '/billing/clients',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('clients/:id')
  @RequiresPermission(PERMISSIONS.BILLING_READ)
  @ApiOperation({ summary: 'Retrieve a client with its sites' })
  async getClientsById(@Param('id') id: string, @Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.billing({
      method: 'get',
      path: `/billing/clients/${encodeURIComponent(id)}${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch('clients/:id')
  @RequiresPermission(PERMISSIONS.BILLING_WRITE)
  @ApiOperation({ summary: 'Update a client' })
  async patchClientsById(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.billing({
      method: 'patch',
      path: `/billing/clients/${encodeURIComponent(id)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('clients/:id/sites')
  @RequiresPermission(PERMISSIONS.BILLING_WRITE)
  @ApiOperation({ summary: 'Add a site' })
  async postClientsByIdSites(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.billing({
      method: 'post',
      path: `/billing/clients/${encodeURIComponent(id)}/sites`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch('clients/:id/sites/:siteId')
  @RequiresPermission(PERMISSIONS.BILLING_WRITE)
  @ApiOperation({ summary: 'Update a site' })
  async patchClientsByIdSitesBySiteid(@Param('id') id: string, @Param('siteId') siteId: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.billing({
      method: 'patch',
      path: `/billing/clients/${encodeURIComponent(id)}/sites/${encodeURIComponent(siteId)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('contracts')
  @RequiresPermission(PERMISSIONS.BILLING_READ)
  @ApiOperation({ summary: 'List contracts' })
  async getContracts(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.billing({
      method: 'get',
      path: `/billing/contracts${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('contracts')
  @RequiresPermission(PERMISSIONS.BILLING_WRITE)
  @ApiOperation({ summary: 'Create a contract' })
  async postContracts(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.billing({
      method: 'post',
      path: '/billing/contracts',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('contracts/:id')
  @RequiresPermission(PERMISSIONS.BILLING_READ)
  @ApiOperation({ summary: 'Retrieve a contract' })
  async getContractsById(@Param('id') id: string, @Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.billing({
      method: 'get',
      path: `/billing/contracts/${encodeURIComponent(id)}${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch('contracts/:id')
  @RequiresPermission(PERMISSIONS.BILLING_WRITE)
  @ApiOperation({ summary: 'Update a contract' })
  async patchContractsById(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.billing({
      method: 'patch',
      path: `/billing/contracts/${encodeURIComponent(id)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('invoices/aging')
  @RequiresPermission(PERMISSIONS.BILLING_READ)
  @ApiOperation({ summary: 'Receivables by overdue bucket' })
  async getInvoicesAging(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.billing({
      method: 'get',
      path: `/billing/invoices/aging${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('invoices')
  @RequiresPermission(PERMISSIONS.BILLING_READ)
  @ApiOperation({ summary: 'List invoices' })
  async getInvoices(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.billing({
      method: 'get',
      path: `/billing/invoices${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('invoices')
  @RequiresPermission(PERMISSIONS.BILLING_WRITE)
  @ApiOperation({ summary: 'Issue an invoice' })
  async postInvoices(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.billing({
      method: 'post',
      path: '/billing/invoices',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('invoices/:id/pay')
  @RequiresPermission(PERMISSIONS.BILLING_WRITE)
  @ApiOperation({ summary: 'Mark an invoice paid' })
  async postInvoicesByIdPay(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.billing({
      method: 'post',
      path: `/billing/invoices/${encodeURIComponent(id)}/pay`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Patch('invoices/:id')
  @RequiresPermission(PERMISSIONS.BILLING_WRITE)
  @ApiOperation({ summary: 'Update an invoice' })
  async patchInvoicesById(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.billing({
      method: 'patch',
      path: `/billing/invoices/${encodeURIComponent(id)}`,
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Get('revenue-shares')
  @RequiresPermission(PERMISSIONS.BILLING_READ)
  @ApiOperation({ summary: 'List revenue shares' })
  async getRevenueShares(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    const search = new URLSearchParams(query).toString()
    const result = await this.domains.billing({
      method: 'get',
      path: `/billing/revenue-shares${search ? `?${search}` : ''}`,
      correlationId: correlationOf(request),
    })

    return result.data
  }

  @Post('revenue-shares')
  @RequiresPermission(PERMISSIONS.BILLING_WRITE)
  @ApiOperation({ summary: 'Record a revenue share' })
  async postRevenueShares(@Body() body: unknown, @Req() request: FastifyRequest) {
    const result = await this.domains.billing({
      method: 'post',
      path: '/billing/revenue-shares',
      payload: body,
      correlationId: correlationOf(request),
    })

    return result.data
  }
}

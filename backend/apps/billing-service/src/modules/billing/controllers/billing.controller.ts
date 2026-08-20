import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import {
  CreateClientDto,
  CreateContractDto,
  CreateInvoiceDto,
  CreateSiteDto,
  ListInvoicesDto,
  UpdateClientDto,
  UpdateContractDto,
  UpdateInvoiceDto,
  UpdateSiteDto,
  UpsertRevenueShareDto,
} from '../dto/billing.dto'
import { BillingService } from '../services/billing.service'

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // clientes
  @Get('clients')
  @ApiOperation({ summary: 'List clients' })
  @ApiQuery({ name: 'status', required: false })
  listClients(@Query('status') status?: string) {
    return this.billing.listClients(status)
  }

  @Get('clients/:id')
  @ApiOperation({ summary: 'Retrieve a client with its sites' })
  findClient(@Param('id', ParseIntPipe) id: number) {
    return this.billing.findClient(id)
  }

  @Post('clients')
  @ApiOperation({ summary: 'Create a client' })
  @ApiResponse({ status: 409, description: 'Tax id already used' })
  createClient(@Body() dto: CreateClientDto) {
    return this.billing.createClient(dto)
  }

  @Patch('clients/:id')
  @ApiOperation({ summary: 'Update a client' })
  updateClient(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateClientDto) {
    return this.billing.updateClient(id, dto)
  }

  @Post('clients/:id/sites')
  @ApiOperation({ summary: 'Add a site to a client' })
  createSite(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateSiteDto) {
    return this.billing.createSite(id, dto)
  }

  @Patch('clients/:id/sites/:siteId')
  @ApiOperation({ summary: 'Update a client site' })
  updateSite(
    @Param('id', ParseIntPipe) id: number,
    @Param('siteId', ParseIntPipe) siteId: number,
    @Body() dto: UpdateSiteDto,
  ) {
    return this.billing.updateSite(id, siteId, dto)
  }

  // contratos
  @Get('contracts')
  @ApiOperation({ summary: 'List contracts' })
  listContracts(@Query('client_id') clientId?: string, @Query('status') status?: string) {
    return this.billing.listContracts(clientId ? Number(clientId) : undefined, status)
  }

  @Get('contracts/:id')
  @ApiOperation({ summary: 'Retrieve a contract with the stores it covers' })
  findContract(@Param('id', ParseIntPipe) id: number) {
    return this.billing.findContract(id)
  }

  @Post('contracts')
  @ApiOperation({ summary: 'Create a contract' })
  createContract(@Body() dto: CreateContractDto) {
    return this.billing.createContract(dto)
  }

  @Patch('contracts/:id')
  @ApiOperation({
    summary: 'Update a contract',
    description: 'Sending store_ids replaces the whole coverage — a contract that lost a store must stop covering it.',
  })
  updateContract(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateContractDto) {
    return this.billing.updateContract(id, dto)
  }

  // notas fiscais — aging antes de :id
  @Get('invoices/aging')
  @ApiOperation({
    summary: 'Receivables by overdue bucket',
    description:
      '"Overdue" is derived from due_on, never stored: as a persisted status it would need a daily job, and the figure would depend on that job having run.',
  })
  aging(@Query('on') on?: string) {
    return this.billing.aging(on ? new Date(on) : undefined)
  }

  @Get('invoices')
  @ApiOperation({ summary: 'List invoices' })
  listInvoices(@Query() query: ListInvoicesDto) {
    return this.billing.listInvoices(query)
  }

  @Post('invoices')
  @ApiOperation({
    summary: 'Issue an invoice',
    description: 'due_on is derived from issued_on plus the term — the contract term when none is given.',
  })
  @ApiResponse({ status: 409, description: 'Invoice number already used' })
  createInvoice(@Body() dto: CreateInvoiceDto) {
    return this.billing.createInvoice(dto)
  }

  @Patch('invoices/:id')
  @ApiOperation({ summary: 'Update an invoice' })
  updateInvoice(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateInvoiceDto) {
    return this.billing.updateInvoice(id, dto)
  }

  @Post('invoices/:id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark an invoice paid' })
  markPaid(@Param('id', ParseIntPipe) id: number, @Body('paid_on') paidOn: string) {
    return this.billing.markPaid(id, paidOn)
  }

  // repasse
  @Get('revenue-shares')
  @ApiOperation({ summary: 'List revenue shares' })
  listRevenueShares(@Query('period') period?: string) {
    return this.billing.listRevenueShares(period)
  }

  @Post('revenue-shares')
  @ApiOperation({
    summary: 'Record a revenue share',
    description: 'Without rate_bps the contract rate is used — it is where the rate is negotiated.',
  })
  upsertRevenueShare(@Body() dto: UpsertRevenueShareDto) {
    return this.billing.upsertRevenueShare(dto)
  }
}

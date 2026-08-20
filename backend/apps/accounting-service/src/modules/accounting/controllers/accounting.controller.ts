import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import {
  CreateAccountDto,
  ListEntriesDto,
  PutEntryDto,
  UpdateAccountDto,
  UpsertCashFlowDto,
} from '../dto/accounting.dto'
import { AccountingService } from '../services/accounting.service'

@ApiTags('accounting')
@Controller('accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('accounts')
  @ApiOperation({ summary: 'List the chart of accounts' })
  @ApiQuery({ name: 'statement', required: false, enum: ['pnl', 'cashflow'] })
  listAccounts(@Query('statement') statement?: string) {
    return this.accounting.listAccounts(statement)
  }

  @Post('accounts')
  @ApiOperation({ summary: 'Add an account line' })
  @ApiResponse({ status: 409, description: 'Code already used' })
  createAccount(@Body() dto: CreateAccountDto) {
    return this.accounting.createAccount(dto)
  }

  @Patch('accounts/:id')
  @ApiOperation({ summary: 'Update an account line' })
  updateAccount(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAccountDto) {
    return this.accounting.updateAccount(id, dto)
  }

  @Get('entries')
  @ApiOperation({ summary: 'List ledger entries' })
  listEntries(@Query() query: ListEntriesDto) {
    return this.accounting.listEntries(query)
  }

  @Put('entries')
  @ApiOperation({
    summary: 'Set the value of one account for one period',
    description:
      'Idempotent by (account, period, store): re-posting a month replaces rather than duplicates, so a period can be reprocessed without clearing it first.',
  })
  putEntry(@Body() dto: PutEntryDto) {
    return this.accounting.putEntry(dto)
  }

  @Delete('entries/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a ledger entry' })
  deleteEntry(@Param('id', ParseIntPipe) id: number) {
    return this.accounting.deleteEntry(id)
  }

  @Get('pnl/series')
  @ApiOperation({ summary: 'P&L snapshots over a range' })
  series(@Query('from') from?: string, @Query('to') to?: string, @Query('store_id') storeId?: string) {
    return this.accounting.listSnapshots(from, to, storeId ? Number(storeId) : undefined)
  }

  @Get('pnl/:period')
  @ApiOperation({
    summary: 'The P&L tree for a period',
    description:
      'Without store_id this is the network: entries with a null store plus the per-store entries, because some lines only exist consolidated (accountant, pro-labore) and others only per store (sales).',
  })
  @ApiResponse({ status: 404, description: 'Chart of accounts is empty' })
  pnl(@Param('period') period: string, @Query('store_id') storeId?: string) {
    return this.accounting.pnl(period, storeId ? Number(storeId) : undefined)
  }

  @Post('pnl/:period/compute')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Freeze the period',
    description: 'A closed P&L does not change when someone later corrects the past.',
  })
  compute(
    @Param('period') period: string,
    @Query('store_id') storeId?: string,
    @Query('store_count') storeCount?: string,
    @Query('close') close?: string,
  ) {
    return this.accounting.computeSnapshot(
      period,
      storeId ? Number(storeId) : undefined,
      storeCount ? Number(storeCount) : 0,
      close === 'true',
    )
  }

  @Get('cash-flow')
  @ApiOperation({ summary: 'Cash flow over a range' })
  cashFlow(@Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.listCashFlow(from, to)
  }

  @Put('cash-flow')
  @ApiOperation({
    summary: 'Record a cash flow period',
    description: 'closing_balance is always derived, never accepted from the caller.',
  })
  upsertCashFlow(@Body() dto: UpsertCashFlowDto) {
    return this.accounting.upsertCashFlow(dto)
  }
}

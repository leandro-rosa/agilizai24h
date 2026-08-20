import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import {
  CreateAccountDto,
  CreateFeeDto,
  CreateMappingDto,
  CreateTransactionDto,
  ListTransactionsDto,
  UpdateAccountDto,
  UpdateMappingDto,
  UpdateTransactionDto,
  UpsertSettlementDto,
} from '../dto/treasury.dto'
import { TreasuryService } from '../services/treasury.service'

@ApiTags('treasury')
@Controller('treasury')
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  // contas
  @Get('accounts')
  @ApiOperation({ summary: 'List bank and card accounts' })
  listAccounts() {
    return this.treasury.listAccounts()
  }

  @Post('accounts')
  @ApiOperation({ summary: 'Register an account' })
  createAccount(@Body() dto: CreateAccountDto) {
    return this.treasury.createAccount(dto)
  }

  @Patch('accounts/:id')
  @ApiOperation({ summary: 'Update an account' })
  updateAccount(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAccountDto) {
    return this.treasury.updateAccount(id, dto)
  }

  // DE-PARA — antes de :id para "mappings" não ser lido como identificador
  @Get('mappings')
  @ApiOperation({ summary: 'List counterparty classification rules' })
  listMappings() {
    return this.treasury.listMappings()
  }

  @Post('mappings')
  @ApiOperation({ summary: 'Create a classification rule' })
  @ApiResponse({ status: 409, description: 'That spelling is already mapped' })
  createMapping(@Body() dto: CreateMappingDto) {
    return this.treasury.createMapping(dto)
  }

  @Patch('mappings/:id')
  @ApiOperation({ summary: 'Update a classification rule' })
  updateMapping(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMappingDto) {
    return this.treasury.updateMapping(id, dto)
  }

  @Delete('mappings/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Drop a classification rule' })
  deleteMapping(@Param('id', ParseIntPipe) id: number) {
    return this.treasury.deleteMapping(id)
  }

  @Post('mappings/apply/:period')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Apply the rules to a period',
    description:
      'Only touches transactions with no supplier resolved yet — re-applying never undoes a hand-made correction.',
  })
  applyMappings(@Param('period') period: string) {
    return this.treasury.applyMappings(period)
  }

  // taxas
  @Get('fees')
  @ApiOperation({ summary: 'List acquirer fees, newest effective date first' })
  listFees() {
    return this.treasury.listFees()
  }

  @Post('fees')
  @ApiOperation({
    summary: 'Register an acquirer fee',
    description: 'Dated: a rate change must not rewrite the margin of a month already closed.',
  })
  createFee(@Body() dto: CreateFeeDto) {
    return this.treasury.createFee(dto)
  }

  // liquidação
  @Get('settlements')
  @ApiOperation({ summary: 'List settlement receipts by payment method' })
  listSettlements(@Query('period') period?: string) {
    return this.treasury.listSettlements(period)
  }

  @Post('settlements')
  @ApiOperation({
    summary: 'Record what was received per payment method',
    description: 'Without fee_cents the fee is derived from the rate in force on the settlement date.',
  })
  upsertSettlement(@Body() dto: UpsertSettlementDto) {
    return this.treasury.upsertSettlement(dto)
  }

  // lançamentos
  @Get('transactions/summary')
  @ApiOperation({
    summary: 'Totals for a period, by nature and category',
    description: 'Includes unresolved_count — transactions with no supplier resolved are pending work.',
  })
  summary(@Query() query: ListTransactionsDto) {
    return this.treasury.summary(query)
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List transactions' })
  listTransactions(@Query() query: ListTransactionsDto) {
    return this.treasury.listTransactions(query)
  }

  @Post('transactions')
  @ApiOperation({ summary: 'Record a transaction' })
  createTransaction(@Body() dto: CreateTransactionDto) {
    return this.treasury.createTransaction(dto)
  }

  @Patch('transactions/:id')
  @ApiOperation({ summary: 'Correct a transaction' })
  updateTransaction(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTransactionDto) {
    return this.treasury.updateTransaction(id, dto)
  }

  @Delete('transactions/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a transaction',
    description:
      'Unlike stores and suppliers, a transaction is deletable: a wrongly entered fact must leave, not linger as "inactive" in the P&L.',
  })
  deleteTransaction(@Param('id', ParseIntPipe) id: number) {
    return this.treasury.deleteTransaction(id)
  }
}

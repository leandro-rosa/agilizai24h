import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import {
  CreateContributionDto,
  CreateInvestorDto,
  CreateItemDto,
  UpdateInvestorDto,
  UpdateItemDto,
  UpsertStoreInvestmentDto,
} from '../dto/capex.dto'
import { CapexService } from '../services/capex.service'

@ApiTags('capex')
@Controller('capex')
export class CapexController {
  constructor(private readonly capex: CapexService) {}

  // investimento por loja — rotas fixas antes de :storeId
  @Get('investments/payback')
  @ApiOperation({
    summary: 'Payback per store, fastest first',
    description:
      'payback_months is a DERIVED METRIC, never a fact: it divides the invested total by a monthly profit that is today a panel-entered assumption. Null means undefined — no number of months pays back a store that does not profit — and sorts last, because that is the case needing attention.',
  })
  payback() {
    return this.capex.payback()
  }

  @Get('investments')
  @ApiOperation({ summary: 'List store investments' })
  listInvestments() {
    return this.capex.listInvestments()
  }

  @Get('investments/:storeId')
  @ApiOperation({ summary: 'One store investment with its items' })
  @ApiResponse({ status: 404, description: 'No investment recorded for that store' })
  findInvestment(@Param('storeId', ParseIntPipe) storeId: number) {
    return this.capex.findInvestment(storeId)
  }

  @Put('investments')
  @ApiOperation({
    summary: 'Set the reference revenue and profit of a store',
    description: 'Both are assumptions entered here, not read from sales-service — the payback inherits that label.',
  })
  upsertInvestment(@Body() dto: UpsertStoreInvestmentDto) {
    return this.capex.upsertInvestment(dto)
  }

  @Post('investments/:storeId/recompute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-sum the items and re-derive the payback' })
  recompute(@Param('storeId', ParseIntPipe) storeId: number) {
    return this.capex.recompute(storeId)
  }

  // itens
  @Get('items')
  @ApiOperation({ summary: 'List investment items' })
  listItems(@Query('store_id') storeId?: string, @Query('category') category?: string) {
    return this.capex.listItems(storeId ? Number(storeId) : undefined, category)
  }

  @Post('items')
  @ApiOperation({
    summary: 'Record an investment item',
    description: 'The store total and payback are recomputed on every item write.',
  })
  createItem(@Body() dto: CreateItemDto) {
    return this.capex.createItem(dto)
  }

  @Patch('items/:id')
  @ApiOperation({
    summary: 'Update an investment item',
    description: 'Moving an item between stores recomputes both, so the old store stops counting what it no longer has.',
  })
  updateItem(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateItemDto) {
    return this.capex.updateItem(id, dto)
  }

  @Delete('items/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an investment item' })
  deleteItem(@Param('id', ParseIntPipe) id: number) {
    return this.capex.deleteItem(id)
  }

  // investidores
  @Get('investors/summary')
  @ApiOperation({ summary: 'Committed vs. contributed per investor' })
  investorSummary() {
    return this.capex.investorSummary()
  }

  @Get('investors')
  @ApiOperation({ summary: 'List investors' })
  listInvestors() {
    return this.capex.listInvestors()
  }

  @Get('investors/:id')
  @ApiOperation({ summary: 'One investor with their contributions' })
  findInvestor(@Param('id', ParseIntPipe) id: number) {
    return this.capex.findInvestor(id)
  }

  @Post('investors')
  @ApiOperation({ summary: 'Register an investor' })
  createInvestor(@Body() dto: CreateInvestorDto) {
    return this.capex.createInvestor(dto)
  }

  @Patch('investors/:id')
  @ApiOperation({ summary: 'Update an investor' })
  updateInvestor(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateInvestorDto) {
    return this.capex.updateInvestor(id, dto)
  }

  @Post('investors/:id/contributions')
  @ApiOperation({ summary: 'Record a contribution' })
  addContribution(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateContributionDto) {
    return this.capex.addContribution(id, dto)
  }

  @Delete('investors/:id/contributions/:contributionId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a contribution' })
  deleteContribution(
    @Param('id', ParseIntPipe) id: number,
    @Param('contributionId', ParseIntPipe) contributionId: number,
  ) {
    return this.capex.deleteContribution(id, contributionId)
  }
}

import { Body, Controller, Get, Headers, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ConfirmSettlementDto, ListSettlementsDto, PaySettlementDto, ProposeSettlementDto } from '../dto/settlement.dto'
import { SettlementService } from '../services/settlement.service'

@ApiTags('settlements')
@Controller('settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementService) {}

  @Get()
  @ApiOperation({ summary: 'Settlements, newest week first' })
  list(@Query() query: ListSettlementsDto) {
    return this.settlements.list({ supplierId: query.supplier_id, state: query.state })
  }

  @Get('open-total')
  @ApiOperation({ summary: 'Confirmed-and-unpaid total, and how many proposals still wait for a decision' })
  openTotal() {
    return this.settlements.openTotal()
  }

  @Post('propose')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Compute (or recompute) the weekly settlement of a supplier as a proposal',
    description: 'Owed = units sold × unit cost for on-sale items. Nothing is owed until a person confirms it.',
  })
  propose(@Body() dto: ProposeSettlementDto, @Headers('x-correlation-id') correlationId?: string) {
    return this.settlements.propose(dto, correlationId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'One settlement with its evidence' })
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.settlements.findById(id)
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a proposal. A partial week needs accept_partial.' })
  confirm(@Param('id', ParseIntPipe) id: number, @Body() dto: ConfirmSettlementDto) {
    return this.settlements.confirm(id, dto.accept_partial === true)
  }

  @Post(':id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record that a confirmed settlement was paid. The system never pays or posts anything.' })
  pay(@Param('id', ParseIntPipe) id: number, @Body() dto: PaySettlementDto) {
    return this.settlements.markPaid(id, dto.paid_on, dto.note)
  }
}

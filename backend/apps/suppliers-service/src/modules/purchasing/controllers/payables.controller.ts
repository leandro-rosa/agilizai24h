import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { PayDto, UndoPayDto } from '../dto/payables.dto'
import { PayablesService } from '../services/payables.service'

@ApiTags('payables')
@Controller('payables')
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  @Get()
  @ApiOperation({ summary: 'The payables screen: summary, series, agenda, orders and reconciliation for a month' })
  overview(@Query('month') month?: string) {
    return this.payables.overview(month)
  }

  @Post('pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record the payment of the open paid items of some purchases (the system never pays)' })
  pay(@Body() dto: PayDto) {
    return this.payables.pay(dto)
  }

  @Post('undo')
  @HttpCode(200)
  @ApiOperation({ summary: 'Undo a recorded payment' })
  undo(@Body() dto: UndoPayDto) {
    return this.payables.undo(dto)
  }
}

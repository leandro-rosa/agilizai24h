import { Body, Controller, Get, Headers, HttpCode, ParseIntPipe, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ClosingQueryDto, ConfirmClosingDto } from '../dto/closing.dto'
import { ClosingService } from '../services/closing.service'

@ApiTags('closings')
@Controller('closings')
export class ClosingsController {
  constructor(private readonly closings: ClosingService) {}

  @Get('status')
  @ApiOperation({ summary: 'Last settlement, configured products and the next period to close' })
  status(@Query('supplier_id', ParseIntPipe) supplierId: number) {
    return this.closings.status(supplierId)
  }

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Calculate a closing for the chosen supplier and period. Read-only: stores nothing, owes nothing.' })
  preview(@Body() dto: ClosingQueryDto, @Headers('x-correlation-id') correlationId?: string) {
    return this.closings.preview(dto, correlationId)
  }

  @Post('confirm')
  @HttpCode(201)
  @ApiOperation({ summary: 'Confirm the closing of the period (recalculated here); it becomes owed' })
  confirm(@Body() dto: ConfirmClosingDto, @Headers('x-correlation-id') correlationId?: string) {
    return this.closings.confirm(dto, correlationId)
  }
}

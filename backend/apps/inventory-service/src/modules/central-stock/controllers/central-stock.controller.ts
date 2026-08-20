import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CreateLotDto, ListLotsDto, UpdateLotDto } from '../dto/central-stock.dto'
import { CentralStockService } from '../services/central-stock.service'

@ApiTags('central-stock')
@Controller('inventory/central')
export class CentralStockController {
  constructor(private readonly central: CentralStockService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'What is sitting in the warehouse and what is about to expire',
    description:
      'valued_amount_cents only counts lots with a unit cost, and valued_lot_count says over how many — so the figure never passes as complete when it is not.',
  })
  summary() {
    return this.central.summary()
  }

  @Get()
  @ApiOperation({
    summary: 'List warehouse lots, nearest expiry first',
    description:
      'expiring_within_days includes already-expired lots on purpose: whoever asks what expires in 30 days needs to see first what already expired and is still on the shelf.',
  })
  list(@Query() query: ListLotsDto) {
    return this.central.list(query)
  }

  @Post()
  @ApiOperation({ summary: 'Record a warehouse lot' })
  create(@Body() dto: CreateLotDto) {
    return this.central.create(dto)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a lot' })
  @ApiResponse({ status: 404, description: 'No such lot' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLotDto) {
    return this.central.update(id, dto)
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a lot' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.central.remove(id)
  }
}

import { Body, Controller, Get, Param, ParseIntPipe, Put } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ScheduleService } from './schedule.service'

@ApiTags('schedules')
@Controller('schedules')
export class ScheduleController {
  constructor(private readonly schedules: ScheduleService) {}

  @Get(':storeId')
  @ApiOperation({ summary: 'Planned visit weekdays of a store (its override, or the default)' })
  get(@Param('storeId', ParseIntPipe) storeId: number) {
    return this.schedules.weekdaysFor(storeId)
  }

  @Put(':storeId')
  @ApiOperation({
    summary: 'Override the visit weekdays of one store',
    description: 'Append-only: the previous override stays in history. Other stores are unaffected.',
  })
  set(@Param('storeId', ParseIntPipe) storeId: number, @Body() body: { weekdays: number[]; note?: string }) {
    return this.schedules.setOverride(storeId, body?.weekdays, body?.note)
  }
}

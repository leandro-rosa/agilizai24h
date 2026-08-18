import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ApiProperty } from '@nestjs/swagger'
import { IsInt, Min } from 'class-validator'
import { DerivedEventsPublisher } from '../services/derived-events.publisher'
import { InventoryService } from '../services/inventory.service'

export class SetMinimumDto {
  @ApiProperty({ description: 'The level at or below which the SKU is reported as low.' })
  @IsInt()
  @Min(0)
  minimum: number
}

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly derived: DerivedEventsPublisher,
  ) {}

  @Get(':storeId')
  @ApiOperation({
    summary: 'Derived stock for a store',
    description:
      'Closing balance per SKU as of the requested period, or the latest known one. `has_inconsistencies` is set when any balance is negative, so a listing cannot be mistaken for clean.',
  })
  @ApiQuery({ name: 'period', required: false, example: '2026-03' })
  @ApiResponse({ status: 404, description: 'No stock has been derived for that store' })
  stockForStore(@Param('storeId', ParseIntPipe) storeId: number, @Query('period') period?: string) {
    return this.inventory.stockForStore(storeId, period)
  }

  @Get(':storeId/below-minimum')
  @ApiOperation({
    summary: 'SKUs at or below their configured minimum',
    description: 'Only SKUs that actually have a minimum — without one there is no judgement to make.',
  })
  @ApiQuery({ name: 'period', required: false })
  belowMinimum(@Param('storeId', ParseIntPipe) storeId: number, @Query('period') period?: string) {
    return this.inventory.belowMinimum(storeId, period)
  }

  @Get(':storeId/minimums')
  @ApiOperation({ summary: 'Configured minimum levels for a store' })
  listMinimums(@Param('storeId', ParseIntPipe) storeId: number) {
    return this.inventory.listMinimums(storeId)
  }

  @Get(':storeId/:sku')
  @ApiOperation({
    summary: 'Derived stock for one SKU',
    description: 'A SKU with no recorded movements is reported as not found, never as a stock of zero.',
  })
  @ApiQuery({ name: 'period', required: false })
  stockForSku(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Param('sku') sku: string,
    @Query('period') period?: string,
  ) {
    return this.inventory.stockForSku(storeId, sku, period)
  }

  @Put(':storeId/:sku/minimum')
  @ApiOperation({ summary: 'Configure a minimum level' })
  setMinimum(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Param('sku') sku: string,
    @Body() dto: SetMinimumDto,
  ) {
    return this.inventory.setMinimum(storeId, sku, dto.minimum)
  }

  @Post(':storeId/recompute')
  @ApiOperation({
    summary: 'Recompute a store stock',
    description: 'For backfills and corrections that produce no period event.',
  })
  @ApiQuery({ name: 'from', required: true, example: '2026-01' })
  async recompute(@Param('storeId', ParseIntPipe) storeId: number, @Query('from') from: string) {
    const result = await this.inventory.recomputeStore(storeId, from)

    // A backfill moves closing stock exactly like an ingestion does, so
    // reconciliation has to hear about it too — otherwise the only way to fix a
    // stale figure downstream would be a second manual call over there.
    await this.derived.publishPeriodsDerived(storeId, result.periods, new Date().toISOString())

    return result
  }

  @Delete(':storeId/:sku')
  @ApiOperation({
    summary: 'Refused — stock is derived, not entered',
    description: 'Correct the underlying sales or supply data instead.',
  })
  @ApiResponse({ status: 405, description: 'Always' })
  refuse() {
    return this.inventory.setStock()
  }
}

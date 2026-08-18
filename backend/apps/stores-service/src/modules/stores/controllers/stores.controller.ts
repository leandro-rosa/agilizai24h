import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CreateStoreDto } from '../dto/create-store.dto'
import { ListStoresDto } from '../dto/list-stores.dto'
import { SetStatusDto } from '../dto/set-status.dto'
import { UpdateStoreDto } from '../dto/update-store.dto'
import { StoresService } from '../services/stores.service'

@ApiTags('stores')
@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  @ApiOperation({
    summary: 'List stores',
    description: 'Without an explicit status filter, only active stores are returned.',
  })
  list(@Query() query: ListStoresDto) {
    return this.stores.list(query)
  }

  @Get('by-external-code/:code')
  @ApiOperation({
    summary: 'Resolve the POS external code to a store',
    description:
      'Used by ingestion to attribute an uploaded report. Reports 404 when nothing matches rather than guessing from the display name.',
  })
  @ApiResponse({ status: 404, description: 'No store matches that code' })
  findByExternalCode(@Param('code') code: string) {
    return this.stores.findByExternalCode(code)
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Retrieve one store',
    description: 'Resolves regardless of status, so historical records referencing a closed store still work.',
  })
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.stores.findById(id)
  }

  @Post()
  @ApiOperation({ summary: 'Create a store' })
  @ApiResponse({ status: 409, description: 'External code already used by another store' })
  create(@Body() dto: CreateStoreDto) {
    return this.stores.create(dto)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a store', description: 'The internal identifier cannot be changed.' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStoreDto) {
    return this.stores.update(id, dto)
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Change a store lifecycle status' })
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: SetStatusDto) {
    return this.stores.setStatus(id, dto.status)
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Refused — stores are never deleted',
    description: 'Deactivate instead, so past sales and reconciliations keep resolving their store.',
  })
  @ApiResponse({ status: 405, description: 'Always — deletion is not permitted' })
  remove() {
    return this.stores.delete()
  }
}

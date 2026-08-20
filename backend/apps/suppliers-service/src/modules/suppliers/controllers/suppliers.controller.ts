import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CreateAliasDto } from '../dto/create-alias.dto'
import { CreateSupplierDto } from '../dto/create-supplier.dto'
import { ListSuppliersDto } from '../dto/list-suppliers.dto'
import { ResolveSuppliersDto } from '../dto/resolve-suppliers.dto'
import { UpdateSupplierDto } from '../dto/update-supplier.dto'
import { SuppliersService } from '../services/suppliers.service'

@ApiTags('suppliers')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @ApiOperation({
    summary: 'List suppliers',
    description: 'Without an explicit status filter, only active suppliers are returned.',
  })
  list(@Query() query: ListSuppliersDto) {
    return this.suppliers.list(query)
  }

  @Post('resolve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resolve statement spellings to suppliers',
    description:
      'Returns matched and unmatched separately. The unmatched list is the reconciliation work queue — it is never silently dropped.',
  })
  resolve(@Body() dto: ResolveSuppliersDto) {
    return this.suppliers.resolve(dto.names)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve one supplier with its aliases' })
  @ApiResponse({ status: 404, description: 'No such supplier' })
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.suppliers.findById(id)
  }

  @Post()
  @ApiOperation({
    summary: 'Create a supplier',
    description: 'The supplier name is registered as its first alias, so it resolves immediately.',
  })
  @ApiResponse({ status: 409, description: 'Tax id already used by another supplier' })
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliers.create(dto)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a supplier' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSupplierDto) {
    return this.suppliers.update(id, dto)
  }

  @Post(':id/aliases')
  @ApiOperation({ summary: 'Register another spelling for this supplier' })
  @ApiResponse({ status: 409, description: 'That spelling already resolves to another supplier' })
  addAlias(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateAliasDto) {
    return this.suppliers.addAlias(id, dto.alias)
  }

  @Delete(':id/aliases/:aliasId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Drop a spelling' })
  removeAlias(@Param('id', ParseIntPipe) id: number, @Param('aliasId', ParseIntPipe) aliasId: number) {
    return this.suppliers.removeAlias(id, aliasId)
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Refused — suppliers are never deleted',
    description: 'Set status to inactive instead, so historical transactions keep resolving.',
  })
  @ApiResponse({ status: 405, description: 'Always — deletion is not permitted' })
  remove() {
    return this.suppliers.delete()
  }
}

import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { AddCostDto, PutAgreementDto } from '../dto/consignment.dto'
import { ConsignmentAgreementService } from '../services/consignment-agreement.service'

@ApiTags('consignment')
@Controller('consignment/agreements')
export class ConsignmentController {
  constructor(private readonly agreements: ConsignmentAgreementService) {}

  @Get(':supplierId')
  @ApiOperation({ summary: 'The consignment agreement of a supplier and every cost vigência' })
  get(@Param('supplierId', ParseIntPipe) supplierId: number) {
    return this.agreements.get(supplierId)
  }

  @Put(':supplierId')
  @ApiOperation({ summary: "Set the periodicity and first closing day of a supplier's consignment" })
  put(@Param('supplierId', ParseIntPipe) supplierId: number, @Body() dto: PutAgreementDto) {
    return this.agreements.put(supplierId, dto)
  }

  @Post(':supplierId/costs')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a cost vigência for a SKU; never edits an earlier one' })
  addCost(@Param('supplierId', ParseIntPipe) supplierId: number, @Body() dto: AddCostDto) {
    return this.agreements.addCost(supplierId, dto)
  }
}

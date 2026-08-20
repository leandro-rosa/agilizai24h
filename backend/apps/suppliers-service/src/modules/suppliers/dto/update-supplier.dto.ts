import { PartialType } from '@nestjs/swagger'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional } from 'class-validator'
import { CreateSupplierDto } from './create-supplier.dto'
import { SUPPLIER_STATUSES, type SupplierStatus } from '../constants/supplier-vocabulary'

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {
  @ApiPropertyOptional({ enum: SUPPLIER_STATUSES })
  @IsOptional()
  @IsIn(SUPPLIER_STATUSES)
  status?: SupplierStatus
}

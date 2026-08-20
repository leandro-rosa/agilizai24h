import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsIn, IsOptional, IsString } from 'class-validator'
import {
  SUPPLIER_CATEGORIES,
  SUPPLIER_STATUSES,
  type SupplierCategory,
  type SupplierStatus,
} from '../constants/supplier-vocabulary'

export class ListSuppliersDto {
  @ApiPropertyOptional({ enum: SUPPLIER_STATUSES, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')))
  @IsIn(SUPPLIER_STATUSES, { each: true })
  status?: SupplierStatus[]

  @ApiPropertyOptional({ enum: SUPPLIER_CATEGORIES })
  @IsOptional()
  @IsIn(SUPPLIER_CATEGORIES)
  category?: SupplierCategory

  @ApiPropertyOptional({ description: 'Busca por parte do nome, sem acento e sem caixa' })
  @IsOptional()
  @IsString()
  search?: string
}

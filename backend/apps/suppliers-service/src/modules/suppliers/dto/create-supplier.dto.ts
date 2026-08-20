import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { SUPPLIER_CATEGORIES, type SupplierCategory } from '../constants/supplier-vocabulary'

export class CreateSupplierDto {
  @ApiProperty({ example: 'Quinoa Indústria de Alimentos' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legal_name?: string

  @ApiPropertyOptional({ description: 'CNPJ, apenas dígitos ou formatado', example: '35.370.333/0001-00' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tax_id?: string

  @ApiProperty({ enum: SUPPLIER_CATEGORIES })
  @IsIn(SUPPLIER_CATEGORIES)
  category: SupplierCategory

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact_name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

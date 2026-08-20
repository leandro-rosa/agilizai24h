import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { STORE_TYPE_VALUES, type StoreType } from '../constants/store-vocabulary'

export class CreateStoreDto {
  @ApiProperty({ example: 'Agiliz TechPark' })
  @IsString()
  @IsNotEmpty()
  name: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  address: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  city: string

  @ApiProperty({ enum: STORE_TYPE_VALUES })
  @IsIn(STORE_TYPE_VALUES)
  type: StoreType

  @ApiPropertyOptional({
    description: 'The code the POS uses for this store. May be assigned later.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  external_code?: string

  @ApiPropertyOptional({ description: 'CNPJ da unidade que hospeda a loja', example: '13.743.550/0031-68' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tax_id?: string

  @ApiPropertyOptional({
    description: 'Código do site do cliente ("HTL05"). Casa com ClientSite.code no billing — diferente de external_code, que é o código do PDV.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  client_code?: string

  @ApiPropertyOptional({ example: '2025-10-27' })
  @IsOptional()
  @IsDateString()
  opened_on?: string

  @ApiPropertyOptional({ description: 'Pessoas atendidas — denominador do ticket médio' })
  @IsOptional()
  @IsInt()
  @Min(0)
  headcount?: number

  @ApiPropertyOptional({ description: 'Instalação elétrica disponível', example: '1-110v 1-220v' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  voltage?: string
}

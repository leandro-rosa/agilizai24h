import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class CreateLotDto {
  @ApiProperty({ example: '1003' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  sku: string

  @ApiPropertyOptional({ example: '0070847033301' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  ean?: string

  @ApiProperty({ example: 6 })
  @IsInt()
  @Min(0)
  quantity: number

  @ApiPropertyOptional({ description: 'Ausente para item sem validade', example: '2027-05-28' })
  @IsOptional()
  @IsDateString()
  expires_on?: string

  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  received_on: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  supplier_id?: number

  @ApiPropertyOptional({ description: 'Centavos' })
  @IsOptional()
  @IsInt()
  @Min(0)
  unit_cost_cents?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}

export class UpdateLotDto extends PartialType(CreateLotDto) {}

export class ListLotsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sku?: string

  @ApiPropertyOptional({ description: 'Só lotes que vencem dentro de N dias (inclui os já vencidos)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expiring_within_days?: number
}

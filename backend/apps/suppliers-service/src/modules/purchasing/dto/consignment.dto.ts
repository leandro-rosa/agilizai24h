import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator'

export class PutAgreementDto {
  @ApiProperty({ description: '7, 10, 15 ou um número de dias personalizado.', example: 7 })
  @IsInt()
  @Min(1)
  period_days: number

  @ApiPropertyOptional({ description: 'Início do primeiro fechamento regular.', example: '2026-09-30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  first_closing_on?: string
}

export class AddCostDto {
  @ApiProperty({ example: '110022' })
  @IsString()
  @MaxLength(60)
  sku: string

  @ApiProperty({ description: 'Dia em que o custo passa a valer.', example: '2026-09-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  valid_from: string

  @ApiProperty({ description: 'Custo de repasse por unidade, em centavos.' })
  @IsInt()
  @Min(0)
  unit_cost_cents: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string
}

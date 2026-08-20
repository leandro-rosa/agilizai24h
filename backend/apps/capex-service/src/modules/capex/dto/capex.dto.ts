import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import {
  CONTRIBUTION_KINDS,
  INVESTMENT_KINDS,
  ITEM_CATEGORIES,
  type ContributionKind,
  type InvestmentKind,
  type ItemCategory,
} from '../constants/capex-vocabulary'

export class UpsertStoreInvestmentDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  store_id: number

  @ApiPropertyOptional({ description: 'PREMISSA — vem do painel, não de sales-service' })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthly_revenue_cents?: number

  @ApiPropertyOptional({ description: 'PREMISSA — o payback herda esse rótulo' })
  @IsOptional()
  @IsInt()
  monthly_profit_cents?: number
}

export class CreateItemDto {
  @ApiPropertyOptional({ description: 'Ausente = investimento não atribuível a uma loja' })
  @IsOptional()
  @IsInt()
  @Min(1)
  store_id?: number

  @ApiProperty({ enum: ITEM_CATEGORIES })
  @IsIn(ITEM_CATEGORIES)
  category: ItemCategory

  @ApiProperty({ example: 'Refrigerador vertical 4 portas' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  description: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  supplier_id?: number

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number

  @ApiProperty({ description: '"Valor a vista"', example: 259000 })
  @IsInt()
  @Min(0)
  cash_amount_cents: number

  @ApiPropertyOptional({ description: '"Vl parcelado total" — a diferença para o à vista é o custo do crédito' })
  @IsOptional()
  @IsInt()
  @Min(0)
  financed_amount_cents?: number

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  installments?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  installment_amount_cents?: number

  @ApiProperty({ example: '2025-10-04' })
  @IsDateString()
  purchased_on: string

  @ApiProperty({ example: 'Josias' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  funding_source: string

  @ApiProperty({ enum: INVESTMENT_KINDS })
  @IsIn(INVESTMENT_KINDS)
  investment_kind: InvestmentKind
}

export class UpdateItemDto extends PartialType(CreateItemDto) {}

export class CreateInvestorDto {
  @ApiProperty({ example: 'Josias' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string

  @ApiPropertyOptional({ description: '"VALOR INVESTIMENTO" — o comprometido' })
  @IsOptional()
  @IsInt()
  @Min(0)
  committed_amount_cents?: number
}

export class UpdateInvestorDto extends PartialType(CreateInvestorDto) {}

export class CreateContributionDto {
  @ApiProperty({ example: '2025-10-01' })
  @IsDateString()
  contributed_on: string

  @ApiProperty()
  @IsInt()
  @Min(0)
  amount_cents: number

  @ApiProperty({ enum: CONTRIBUTION_KINDS })
  @IsIn(CONTRIBUTION_KINDS)
  kind: ContributionKind

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}

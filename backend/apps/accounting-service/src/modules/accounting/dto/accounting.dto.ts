import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator'
import {
  ORIGINS,
  PERIOD_PATTERN,
  SECTIONS,
  STATEMENTS,
  type Origin,
  type Section,
  type Statement,
} from '../constants/accounting-vocabulary'

const PERIOD_MESSAGE = 'period deve ser "YYYY-MM"'

export class CreateAccountDto {
  @ApiProperty({ example: '3.1.01' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string

  @ApiProperty({ example: 'Vendas lojas' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  label: string

  @ApiProperty({ enum: STATEMENTS })
  @IsIn(STATEMENTS)
  statement: Statement

  @ApiProperty({ enum: SECTIONS })
  @IsIn(SECTIONS)
  section: Section

  @ApiProperty({ description: '+1 entra, -1 sai', enum: [1, -1] })
  @IsIn([1, -1])
  sign: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  parent_id?: number

  @ApiProperty()
  @IsInt()
  sort_order: number

  @ApiPropertyOptional({ description: 'A linha é aberta por loja?' })
  @IsOptional()
  per_store?: boolean

  @ApiPropertyOptional({
    description: 'Automatic data source for this account, or null/omitted to stay manual-only.',
    enum: ['treasury_category', 'sales_revenue', 'finance_cogs', 'finance_loss'],
  })
  @IsOptional()
  @IsIn(['treasury_category', 'sales_revenue', 'finance_cogs', 'finance_loss'])
  auto_source?: string

  @ApiPropertyOptional({ description: "Treasury category name, only meaningful when auto_source = 'treasury_category'." })
  @IsOptional()
  @IsString()
  treasury_category?: string
}

export class UpdateAccountDto extends PartialType(CreateAccountDto) {}

export class PutEntryDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  account_id: number

  @ApiProperty({ example: '2026-07' })
  @Matches(PERIOD_PATTERN, { message: PERIOD_MESSAGE })
  period: string

  @ApiPropertyOptional({ description: 'Ausente = consolidado da rede.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  store_id?: number

  @ApiProperty({ description: 'Positivo. O sinal da conta é aplicado na apuração.' })
  @IsInt()
  @Min(0)
  amount_cents: number

  @ApiPropertyOptional({ enum: ORIGINS, default: 'manual' })
  @IsOptional()
  @IsIn(ORIGINS)
  origin?: Origin

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  source_ref?: string
}

export class ListEntriesDto {
  @ApiPropertyOptional({ example: '2026-07' })
  @IsOptional()
  @Matches(PERIOD_PATTERN, { message: PERIOD_MESSAGE })
  period?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(PERIOD_PATTERN, { message: PERIOD_MESSAGE })
  from?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(PERIOD_PATTERN, { message: PERIOD_MESSAGE })
  to?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number

  @ApiPropertyOptional({ enum: STATEMENTS })
  @IsOptional()
  @IsIn(STATEMENTS)
  statement?: Statement
}

export class UpsertCashFlowDto {
  @ApiProperty({ example: '2026-07' })
  @Matches(PERIOD_PATTERN, { message: PERIOD_MESSAGE })
  period: string

  @ApiProperty()
  @IsInt()
  opening_balance_cents: number

  @ApiProperty()
  @IsInt()
  @Min(0)
  receipts_cents: number

  @ApiProperty()
  @IsInt()
  @Min(0)
  opex_cents: number

  @ApiProperty()
  @IsInt()
  @Min(0)
  loan_payments_cents: number

  @ApiProperty()
  @IsInt()
  @Min(0)
  capex_cents: number
}

export class RegisterMonthlySummaryDto {
  @ApiProperty({ description: 'Hash do conteúdo calculado no navegador (sha-256 hex).' })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: 'content_hash deve ser sha-256 em hexadecimal' })
  content_hash: string

  @ApiProperty({ description: 'Parâmetros usados no resumo (comparações, limiares, versão da lógica).' })
  @IsNotEmpty()
  params: Record<string, unknown>
}

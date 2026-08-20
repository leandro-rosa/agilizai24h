import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import {
  ACCOUNT_KINDS,
  DIRECTIONS,
  NATURES,
  PAYMENT_METHODS,
  PERIOD_PATTERN,
  type AccountKind,
  type Direction,
  type Nature,
  type PaymentMethod,
} from '../constants/treasury-vocabulary'

const PERIOD_MESSAGE = 'period deve ser "YYYY-MM"'

export class CreateAccountDto {
  @ApiProperty({ example: 'C6 bank' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string

  @ApiProperty({ enum: ACCOUNT_KINDS })
  @IsIn(ACCOUNT_KINDS)
  kind: AccountKind

  @ApiProperty({ example: 'Banco C6 S.A.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  institution: string

  @ApiPropertyOptional({ example: '4321' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  last_digits?: string
}

export class UpdateAccountDto extends PartialType(CreateAccountDto) {
  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive'
}

export class CreateTransactionDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  account_id: number

  @ApiProperty({ example: '2026-07-16' })
  @IsDateString()
  occurred_on: string

  @ApiProperty({ example: '2026-07' })
  @Matches(PERIOD_PATTERN, { message: PERIOD_MESSAGE })
  period: string

  @ApiProperty({ enum: DIRECTIONS })
  @IsIn(DIRECTIONS)
  direction: Direction

  @ApiProperty({ description: 'Sempre positivo — o sinal está em `direction`.', example: 181038 })
  @IsInt()
  @Min(0)
  amount_cents: number

  @ApiProperty({ example: 'ASSAÍ ATACADISTA LJ49' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  counterparty_raw: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  supplier_id?: number

  @ApiProperty({ example: 'estoque' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  entry_type: string

  @ApiProperty({ example: 'estoque geral' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  category: string

  @ApiProperty({ enum: NATURES })
  @IsIn(NATURES)
  nature: Nature

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  store_id?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  installment_index?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  installment_total?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  source_ref?: string
}

export class UpdateTransactionDto extends PartialType(CreateTransactionDto) {}

export class ListTransactionsDto {
  @ApiPropertyOptional({ example: '2026-07' })
  @IsOptional()
  @Matches(PERIOD_PATTERN, { message: PERIOD_MESSAGE })
  period?: string

  @ApiPropertyOptional({ description: 'Início de um intervalo fechado, com `to`.' })
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
  account_id?: number

  @ApiPropertyOptional({ enum: NATURES })
  @IsOptional()
  @IsIn(NATURES)
  nature?: Nature

  @ApiPropertyOptional({ enum: DIRECTIONS })
  @IsOptional()
  @IsIn(DIRECTIONS)
  direction?: Direction

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  supplier_id?: number

  @ApiPropertyOptional({ description: 'Só lançamentos ainda sem fornecedor resolvido.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unresolved?: boolean
}

export class CreateMappingDto {
  @ApiProperty({ example: 'ASSAÍ ATACADISTA LJ49' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  match_text: string

  @ApiProperty({ example: 'Assaí Atacadista' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  display_name: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  supplier_id?: number

  @ApiProperty({ example: 'estoque' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  entry_type: string

  @ApiProperty({ example: 'estoque geral' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  category: string

  @ApiProperty({ enum: NATURES })
  @IsIn(NATURES)
  nature: Nature
}

export class UpdateMappingDto extends PartialType(CreateMappingDto) {}

export class CreateFeeDto {
  @ApiProperty({ example: 'PagSeguro' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  acquirer: string

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  payment_method: PaymentMethod

  @ApiProperty({ description: 'Basis points: 139 = 1,39%.', example: 139 })
  @IsInt()
  @Min(0)
  @Max(10_000)
  rate_bps: number

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  effective_from: string
}

export class UpsertSettlementDto {
  @ApiPropertyOptional({ description: 'Ausente = consolidado da rede.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  store_id?: number

  @ApiProperty({ example: '2026-07' })
  @Matches(PERIOD_PATTERN, { message: PERIOD_MESSAGE })
  period: string

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  payment_method: PaymentMethod

  @ApiProperty()
  @IsInt()
  @Min(0)
  gross_cents: number

  @ApiPropertyOptional({
    description: 'Ausente = derivado da taxa vigente do adquirente na data da liquidação.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  fee_cents?: number

  @ApiPropertyOptional({ example: '2026-08-02' })
  @IsOptional()
  @IsDateString()
  settled_on?: string
}

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
  ValidateIf,
} from 'class-validator'
import {
  ACCOUNT_KINDS,
  DIRECTIONS,
  KINDS,
  MAPPING_KINDS,
  MATCH_TYPES,
  NATURES,
  PAYMENT_METHODS,
  PERIOD_PATTERN,
  type AccountKind,
  type Direction,
  type Kind,
  type MappingKind,
  type MatchType,
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

  @ApiProperty({
    enum: KINDS,
    description: 'revenue | expense | movement | pending. Só `expense` carrega `nature`.',
  })
  @IsIn(KINDS)
  kind: Kind

  @ApiPropertyOptional({
    enum: NATURES,
    description: 'Obrigatório quando `kind: expense`; ausente para os demais kinds.',
  })
  @ValidateIf(o => o.kind === 'expense')
  @IsIn(NATURES)
  nature?: Nature

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

  @ApiPropertyOptional({
    description: 'Id do lançamento que este neutraliza (mesmo período). Ver POST /transactions/neutralize.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  neutralized_with_id?: number
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

  @ApiPropertyOptional({
    description: 'Início de um intervalo de dias sobre `occurred_on` (data real do lançamento), com `occurred_to`. Independente de `period`/`from`/`to`.',
  })
  @IsOptional()
  @IsDateString()
  occurred_from?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  occurred_to?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  account_id?: number

  @ApiPropertyOptional({ enum: NATURES })
  @IsOptional()
  @IsIn(NATURES)
  nature?: Nature

  @ApiPropertyOptional({ enum: KINDS })
  @IsOptional()
  @IsIn(KINDS)
  kind?: Kind

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

  @ApiPropertyOptional({
    enum: MAPPING_KINDS,
    default: 'expense',
    description: 'revenue | expense | movement — nunca pending (uma regra sempre resolve para algo).',
  })
  @IsOptional()
  @IsIn(MAPPING_KINDS)
  kind?: MappingKind

  @ApiPropertyOptional({
    enum: NATURES,
    description: 'Obrigatório quando `kind: expense` (o default); ausente para os demais kinds.',
  })
  @ValidateIf(o => (o.kind ?? 'expense') === 'expense')
  @IsIn(NATURES)
  nature?: Nature

  @ApiPropertyOptional({
    enum: MATCH_TYPES,
    default: 'exact',
    description: '`exact`: favorecido igual a match_text. `contains`: favorecido contém match_text.',
  })
  @IsOptional()
  @IsIn(MATCH_TYPES)
  match_type?: MatchType
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

export class NeutralizeDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  a_id: number

  @ApiProperty()
  @IsInt()
  @Min(1)
  b_id: number
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

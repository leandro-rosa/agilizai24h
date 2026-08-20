import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsDateString,
  IsEmail,
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
  CONTRACT_KINDS,
  CONTRACT_STATUSES,
  INVOICE_KINDS,
  INVOICE_STATUSES,
  PERIOD_PATTERN,
  SEGMENTS,
  type ContractKind,
  type ContractStatus,
  type InvoiceKind,
  type InvoiceStatus,
  type Segment,
} from '../constants/billing-vocabulary'

const PERIOD_MESSAGE = 'period deve ser "YYYY-MM"'

export class CreateClientDto {
  @ApiProperty({ example: 'Ascenty' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string

  @ApiProperty({ example: 'Ascenty Data Centers e Telecomunicações S.A.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  legal_name: string

  @ApiProperty({ example: '13.743.550/0001-42' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  tax_id: string

  @ApiProperty({ enum: SEGMENTS })
  @IsIn(SEGMENTS)
  segment: Segment

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  contact_name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string
}

export class UpdateClientDto extends PartialType(CreateClientDto) {
  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive'
}

export class CreateSiteDto {
  @ApiProperty({ example: 'HTL05' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code: string

  @ApiPropertyOptional({ description: 'CNPJ da unidade, quando difere da matriz' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tax_id?: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  address: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  city: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  employees?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  employees_and_clients?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  service_providers?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  visitors?: number

  @ApiPropertyOptional({ description: 'Total ponderado por dia — denominador do ticket médio' })
  @IsOptional()
  @IsInt()
  @Min(0)
  weighted_daily_traffic?: number

  @ApiPropertyOptional({ description: 'Loja Agiliz instalada nesta unidade' })
  @IsOptional()
  @IsInt()
  @Min(1)
  store_id?: number
}

export class UpdateSiteDto extends PartialType(CreateSiteDto) {}

export class CreateContractDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  client_id: number

  @ApiProperty({ example: 'Contrato de parceria Agiliz.ai & Ascenty' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reference: string

  @ApiProperty({ enum: CONTRACT_KINDS })
  @IsIn(CONTRACT_KINDS)
  kind: ContractKind

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthly_fee_cents?: number

  @ApiPropertyOptional({ description: 'Basis points: 500 = 5%', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  revenue_share_bps?: number

  @ApiPropertyOptional({ description: 'Basis points', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  convenience_fee_bps?: number

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  payment_term_days?: number

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  starts_on: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  ends_on?: string

  @ApiPropertyOptional({ description: 'Lojas cobertas por este contrato', type: [Number] })
  @IsOptional()
  @IsInt({ each: true })
  store_ids?: number[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  document_url?: string
}

export class UpdateContractDto extends PartialType(CreateContractDto) {
  @ApiPropertyOptional({ enum: CONTRACT_STATUSES })
  @IsOptional()
  @IsIn(CONTRACT_STATUSES)
  status?: ContractStatus
}

export class CreateInvoiceDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  client_id: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  contract_id?: number

  @ApiProperty({ example: '40' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  number: string

  @ApiPropertyOptional({ example: '4500000731' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  purchase_order?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  service_sheet?: string

  @ApiProperty({ enum: INVOICE_KINDS })
  @IsIn(INVOICE_KINDS)
  kind: InvoiceKind

  @ApiProperty({ example: '2026-01' })
  @Matches(PERIOD_PATTERN, { message: PERIOD_MESSAGE })
  period: string

  @ApiProperty({ example: 70000 })
  @IsInt()
  @Min(0)
  amount_cents: number

  @ApiProperty({ example: '2026-01-14' })
  @IsDateString()
  issued_on: string

  @ApiPropertyOptional({ description: 'Ausente = o prazo do contrato, ou 30 dias', default: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  payment_term_days?: number
}

export class UpdateInvoiceDto extends PartialType(CreateInvoiceDto) {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  paid_on?: string
}

export class ListInvoicesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  client_id?: number

  @ApiPropertyOptional({ example: '2026-07' })
  @IsOptional()
  @Matches(PERIOD_PATTERN, { message: PERIOD_MESSAGE })
  period?: string

  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus
}

export class UpsertRevenueShareDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  contract_id: number

  @ApiProperty()
  @IsInt()
  @Min(1)
  store_id: number

  @ApiProperty({ example: '2026-07' })
  @Matches(PERIOD_PATTERN, { message: PERIOD_MESSAGE })
  period: string

  @ApiProperty()
  @IsInt()
  @Min(0)
  base_revenue_cents: number

  @ApiPropertyOptional({ description: 'Ausente = o percentual do contrato' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  rate_bps?: number
}

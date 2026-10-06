import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator'
import { CONDITIONS, ORIGINS, PAYMENT_STATUSES, type Condition, type Origin, type PaymentStatus } from '../constants/purchase-vocabulary'

export class PurchaseItemDto {
  @ApiProperty({ example: '100115' })
  @IsString()
  @IsNotEmpty()
  sku: string

  @ApiPropertyOptional({ description: 'Como o item apareceu na nota ou planilha.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string

  @ApiProperty({ description: 'Unidades (caixa já convertida).', example: 300 })
  @IsInt()
  @Min(1)
  quantity: number

  @ApiProperty({ description: 'Centavos por unidade. Bonificação pode ser 0.', example: 800 })
  @IsInt()
  @Min(0)
  unit_cost_cents: number

  @ApiProperty({ enum: CONDITIONS })
  @IsIn(CONDITIONS)
  condition: Condition
}

export class CreatePurchaseDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  supplier_id: number

  @ApiProperty({ example: '2026-10-05' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  ordered_on: string

  @ApiPropertyOptional({ enum: ORIGINS, description: 'manual (padrão) ou nfe.' })
  @IsOptional()
  @IsIn(ORIGINS)
  origin?: Origin

  @ApiPropertyOptional({ description: 'Número da nota, quando há. Opcional: fornecedor sem nota entra do mesmo jeito.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  invoice_number?: string

  @ApiPropertyOptional({ description: 'Chave de acesso da NF-e (44 dígitos).' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  invoice_key?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoice_object_key?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string

  @ApiProperty({ type: [PurchaseItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[]
}

export class UpdatePurchaseItemDto {
  @ApiPropertyOptional({ enum: CONDITIONS })
  @IsOptional()
  @IsIn(CONDITIONS)
  condition?: Condition

  @ApiPropertyOptional({ enum: PAYMENT_STATUSES })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  payment_status?: PaymentStatus

  @ApiPropertyOptional({ example: '2026-10-12' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paid_on?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  payment_note?: string
}

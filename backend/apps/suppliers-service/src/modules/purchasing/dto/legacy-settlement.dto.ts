import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator'

export class LegacyLineDto {
  @ApiProperty({ example: 'Pão de mel' })
  @IsString()
  @MaxLength(200)
  name: string

  @ApiPropertyOptional({ description: 'SKU do produto, quando conhecido. Nunca é adivinhado.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string | null

  @ApiProperty({ description: 'Custo de repasse por unidade, em centavos.' })
  @IsInt()
  @Min(0)
  unit_cost_cents: number

  @ApiProperty({ description: 'Unidades acertadas.' })
  @IsInt()
  @Min(0)
  quantity: number

  @ApiProperty({ description: 'quantidade × custo, em centavos.' })
  @IsInt()
  @Min(0)
  total_cents: number
}

export class LegacySettlementDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  supplier_id: number

  @ApiProperty({ description: 'Primeiro dia coberto (incluso).', example: '2026-09-22' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period_from: string

  @ApiProperty({ description: 'Último dia coberto (incluso).', example: '2026-09-29' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period_to: string

  @ApiProperty({ example: '2026-09-30' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paid_on: string

  @ApiProperty({ description: 'Total pago, em centavos; tem de ser a soma das linhas.' })
  @IsInt()
  @Min(0)
  total_cents: number

  @ApiProperty({ type: [LegacyLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LegacyLineDto)
  lines: LegacyLineDto[]

  @ApiPropertyOptional({ example: 'planilha do fornecedor' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string

  @ApiPropertyOptional({ description: 'Quem registrou (o gateway preenche com o usuário da sessão).' })
  @IsOptional()
  @IsString()
  actor?: string
}

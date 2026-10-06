import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator'
import { SETTLEMENT_STATES, type SettlementState } from '../constants/purchase-vocabulary'

export class WriteOffDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  item_id: number

  @ApiPropertyOptional({ description: 'Unidades vencidas na semana (não são devidas).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  expired?: number

  @ApiPropertyOptional({ description: 'Unidades devolvidas na semana (não são devidas).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  returned?: number
}

export class ProposeSettlementDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  supplier_id: number

  @ApiProperty({ description: 'Qualquer dia da semana; usa-se a segunda-feira dela.', example: '2026-10-05' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  week_start: string

  @ApiPropertyOptional({ type: [WriteOffDto], description: 'Vencidos e devolvidos informados pelo operador (o abastecimento só os registra por mês).' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WriteOffDto)
  write_offs?: WriteOffDto[]
}

export class ConfirmSettlementDto {
  @ApiPropertyOptional({ description: 'Confirma mesmo com a semana parcial (falta venda com data ou loja). A pessoa assume o número.' })
  @IsOptional()
  @IsBoolean()
  accept_partial?: boolean
}

export class PaySettlementDto {
  @ApiPropertyOptional({ example: '2026-10-12' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paid_on?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string
}

export class ListSettlementsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  supplier_id?: number

  @IsOptional()
  @IsIn(SETTLEMENT_STATES)
  state?: SettlementState
}

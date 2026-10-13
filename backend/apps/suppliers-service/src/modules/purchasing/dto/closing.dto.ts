import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Min, ValidateNested } from 'class-validator'

export class ClosingQueryDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  supplier_id: number

  @ApiProperty({ description: 'Primeiro dia do fechamento (incluso).', example: '2026-09-30' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period_from: string

  @ApiProperty({ description: 'Último dia do fechamento (incluso). Só dias já encerrados.', example: '2026-10-12' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period_to: string
}

export class ClosingExtraDto {
  @ApiProperty({ example: '100083' })
  @IsString()
  sku: string

  @ApiProperty({ description: 'Mês das retiradas (o abastecimento guarda só o mês).', example: '2026-09' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month: string

  @ApiProperty({ enum: ['expired', 'other_reason'] })
  @IsIn(['expired', 'other_reason'])
  kind: 'expired' | 'other_reason'
}

export class HomeStockDto {
  @ApiProperty({ example: '100083' })
  @IsString()
  sku: string

  @ApiProperty({ description: 'Unidades que a pessoa tem em casa/depósito, informadas por ela.' })
  @IsInt()
  @Min(0)
  units: number
}

export class ConfirmClosingDto extends ClosingQueryDto {
  @ApiPropertyOptional({ description: 'Segue mesmo com a venda incompleta quando só falta importação de loja. Custo ou data faltando nunca passa.' })
  @IsOptional()
  @IsBoolean()
  accept_incomplete?: boolean

  @ApiPropertyOptional({ type: [ClosingExtraDto], description: 'Vencidas e outro motivo que a pessoa escolheu pagar neste fechamento, por produto e mês. O servidor recalcula o valor; o que não vier aqui não é pago.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ClosingExtraDto)
  extras?: ClosingExtraDto[]

  @ApiPropertyOptional({ type: [HomeStockDto], description: 'Estoque que a pessoa tem em casa, por produto, informado por ela (o sistema não o conhece). Fica registrado no fechamento para o PDF.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => HomeStockDto)
  home_stock?: HomeStockDto[]

  @ApiPropertyOptional({ description: 'Quem confirmou (o gateway preenche com o usuário da sessão).' })
  @IsOptional()
  @IsString()
  actor?: string
}

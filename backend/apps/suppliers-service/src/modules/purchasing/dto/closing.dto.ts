import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator'

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

export class ConfirmClosingDto extends ClosingQueryDto {
  @ApiPropertyOptional({ description: 'Segue mesmo com a venda incompleta quando só falta importação de loja. Custo ou data faltando nunca passa.' })
  @IsOptional()
  @IsBoolean()
  accept_incomplete?: boolean

  @ApiPropertyOptional({ description: 'Quem confirmou (o gateway preenche com o usuário da sessão).' })
  @IsOptional()
  @IsString()
  actor?: string
}

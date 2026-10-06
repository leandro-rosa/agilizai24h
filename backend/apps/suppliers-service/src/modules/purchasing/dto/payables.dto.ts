import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { PAYMENT_METHODS, type PaymentMethod } from '../constants/purchase-vocabulary'

export class PayDto {
  @ApiProperty({ type: [Number], description: 'Pedidos cujos itens pagos pendentes são baixados.' })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  purchase_ids: number[]

  @ApiPropertyOptional({ example: '2026-10-10', description: 'Dia do pagamento (padrão: hoje).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paid_on?: string

  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string

  @ApiPropertyOptional({ description: 'Preenchido pelo gateway com o usuário da sessão.' })
  @IsOptional()
  @IsString()
  actor?: string
}

export class UndoPayDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  purchase_ids: number[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actor?: string
}

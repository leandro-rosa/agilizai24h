import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator'
import { CONDITIONS, ORIGINS, PAYMENT_STATUSES, PAYMENT_TERMS, STAGES, type Condition, type Origin, type PaymentStatus, type PaymentTerm, type Stage } from '../constants/purchase-vocabulary'

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

  @ApiPropertyOptional({ description: 'Só ao criar já recebido: unidades recebidas (padrão = pedido).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  received_quantity?: number
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

  @ApiPropertyOptional({ enum: STAGES, description: 'Etapa em que o pedido entra. Omitida: recebido (compatível com o lançamento antigo).' })
  @IsOptional()
  @IsIn(STAGES)
  stage?: Stage

  @ApiPropertyOptional({ description: 'Fornecedor que não emite nota: aceita faturado/recebido sem número.' })
  @IsOptional()
  @IsBoolean()
  without_invoice?: boolean

  @ApiPropertyOptional({ example: '2026-10-12', description: 'Dia do recebimento (etapa recebido).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  received_on?: string

  @ApiPropertyOptional({ example: '2026-10-10', description: 'Prazo de entrega combinado.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expected_delivery_on?: string

  @ApiPropertyOptional({ enum: PAYMENT_TERMS })
  @IsOptional()
  @IsIn(PAYMENT_TERMS)
  payment_term?: PaymentTerm

  @ApiPropertyOptional({ example: '2026-10-20', description: 'Vencimento do boleto (payment_term = due_date).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  payment_due_on?: string

  @ApiPropertyOptional({ description: 'Quem registra. O gateway coloca o usuário da sessão aqui e ignora o que o cliente mandar.' })
  @IsOptional()
  @IsString()
  actor?: string

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

export class ReceivedItemDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  item_id: number

  @ApiProperty({ description: 'Unidades recebidas deste item.' })
  @IsInt()
  @Min(0)
  quantity: number
}

export class TransitionDto {
  @ApiProperty({ enum: STAGES, description: 'A etapa seguinte. Não se pula nem se volta.' })
  @IsIn(STAGES)
  to: Stage

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  invoice_number?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  invoice_key?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  without_invoice?: boolean

  @ApiPropertyOptional({ example: '2026-10-12' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  received_on?: string

  @ApiPropertyOptional({ type: [ReceivedItemDto], description: 'Unidades recebidas por item (padrão = pedido).' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivedItemDto)
  received?: ReceivedItemDto[]

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

export class UpdateOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expected_delivery_on?: string

  @ApiPropertyOptional({ enum: PAYMENT_TERMS })
  @IsOptional()
  @IsIn(PAYMENT_TERMS)
  payment_term?: PaymentTerm

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  payment_due_on?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string
}

export class SendOrderEmailDto {
  @ApiProperty({ example: 'vendas@fornecedor.com.br', description: 'Destinatário. O padrão é o e-mail do cadastro do fornecedor; pode ser trocado aqui.' })
  @IsEmail()
  to: string

  @ApiPropertyOptional({ description: 'Texto de abertura do e-mail (o pedido vai abaixo).' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string

  @ApiPropertyOptional({ description: 'PDF do pedido (base64), gerado pelo painel. Máx. 700 KB.' })
  @IsOptional()
  @IsString()
  attachment_base64?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  attachment_name?: string

  @ApiPropertyOptional({ description: 'Enviar de novo um pedido que já foi enviado. Sem isto o reenvio é recusado.' })
  @IsOptional()
  @IsBoolean()
  resend?: boolean

  @ApiPropertyOptional({ description: 'Guardar este endereço no cadastro do fornecedor.' })
  @IsOptional()
  @IsBoolean()
  save_to_supplier?: boolean

  @ApiPropertyOptional({ description: 'Preenchido pelo gateway com o usuário da sessão.' })
  @IsOptional()
  @IsString()
  actor?: string
}

import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString } from 'class-validator'
import { REVIEW_DECISION_VALUES } from '../constants/vocabulary'

/**
 * Batch decision still requires every selected item to receive its own
 * explicit, persisted decision (brief: "mesmo quando houver ações em
 * lote, todos os itens selecionados devem receber uma decisão explícita e
 * persistida") — this DTO applies ONE decision to an explicit id list, it
 * never infers or auto-approves anything.
 */
export class BatchDecisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  item_ids!: number[]

  @IsIn(REVIEW_DECISION_VALUES)
  decision!: (typeof REVIEW_DECISION_VALUES)[number]

  @IsOptional()
  @IsString()
  notes?: string
}

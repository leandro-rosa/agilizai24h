import { Type } from 'class-transformer'
import { IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'
import { REVIEW_DECISION_VALUES } from '../constants/vocabulary'
import { ProductCandidateDto } from './partner-intake.dto'

export class ItemDecisionDto {
  @IsIn(REVIEW_DECISION_VALUES)
  decision!: (typeof REVIEW_DECISION_VALUES)[number]

  /**
   * References an entry already in QuoteItem.candidates by productId.
   * Required when decision is 'approved' or 'changed' AND the choice comes
   * from the original candidate set, not a manual search result.
   */
  @IsOptional()
  @IsString()
  selected_candidate_id?: string

  /**
   * Full candidate payload for a manual-search result NOT present in the
   * item's original `candidates` — the service appends it to `candidates`
   * and selects it. Mutually exclusive with selectedCandidateId in
   * practice (whichever is present wins; selectedCandidate takes priority).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductCandidateDto)
  selected_candidate?: ProductCandidateDto

  @IsOptional()
  @IsString()
  notes?: string
}
